import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { database } from "@/configs/connection.config";
import { aiTokenLimits, aiUsageLogs } from "@/schema/schema";
import { AIAccessError, AIContext } from "@/utils/ai-context.util";
import { ensureOrgAITokenLimit, DEFAULT_PAID_TOKEN_LIMIT } from "@/utils/aiTokenLimit.util";

export interface AIReservation {
  id: string;
  organizationId: string;
  limitId: string;
  reserved: number;
  resetAt: Date | null;
  startedAt: number;
}

export function assertQuota(used: number, limit: number, reserved: number, personal = false): void {
  if (!Number.isSafeInteger(reserved) || reserved <= 0) throw new Error("Invalid AI reservation");
  if (used + reserved > limit) {
    throw new AIAccessError(personal ? 403 : 429,
      personal ? "USER_TOKEN_LIMIT_EXCEEDED" : "ORG_TOKEN_LIMIT_EXCEEDED",
      personal ? "Your personal AI quota cannot cover this request." :
        "Your organization's remaining AI quota cannot cover this request.");
  }
}

export async function reserveAITokens(
  context: AIContext, reserved: number, model: string, metadata?: Record<string, unknown>,
): Promise<AIReservation> {
  return database.transaction(async (tx) => {
    // Shared across processes. No connection is held while waiting for OpenAI.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-quota:${context.organizationId}`}, 0))`);
    const record = await ensureOrgAITokenLimit(tx, context.organizationId, DEFAULT_PAID_TOKEN_LIMIT);
    const [limit] = await tx.select().from(aiTokenLimits)
      .where(eq(aiTokenLimits.id, record.id)).for("update");
    if (!limit?.isActive) throw new AIAccessError(403, "AI_QUOTA_DISABLED", "AI quota is disabled.");

    const now = new Date();
    // Renew lazily as well as in the cron, so a delayed job does not block a new month.
    if (limit.period === "monthly" && limit.resetAt && limit.resetAt <= now) {
      limit.tokensUsed = 0;
      limit.resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      await tx.update(aiTokenLimits).set({ tokensUsed: 0, resetAt: limit.resetAt, updatedAt: now })
        .where(eq(aiTokenLimits.id, limit.id));
    }
    assertQuota(limit.tokensUsed, limit.tokenLimit, reserved);

    const [personal] = await tx.select().from(aiTokenLimits).where(and(
      eq(aiTokenLimits.organizationId, context.organizationId), eq(aiTokenLimits.userId, context.userId),
      isNull(aiTokenLimits.feature), eq(aiTokenLimits.isActive, true),
    )).limit(1);
    if (personal && personal.tokenLimit > 0) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [usage] = await tx.select({ total: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)` })
        .from(aiUsageLogs).where(and(
          eq(aiUsageLogs.organizationId, context.organizationId), eq(aiUsageLogs.userId, context.userId),
          inArray(aiUsageLogs.status, ["success", "pending"]), gte(aiUsageLogs.createdAt, monthStart),
        ));
      assertQuota(Number(usage?.total ?? 0), personal.tokenLimit, reserved, true);
    }

    const id = randomUUID();
    await tx.insert(aiUsageLogs).values({
      id, organizationId: context.organizationId, userId: context.userId,
      feature: context.feature, endpoint: context.endpoint, provider: "openai", model,
      status: "pending", totalTokens: reserved, promptTokens: 0, completionTokens: 0,
      metadata: { ...metadata, reservation: { limitId: limit.id, reserved, resetAt: limit.resetAt } },
    });
    await tx.update(aiTokenLimits).set({ tokensUsed: limit.tokensUsed + reserved, updatedAt: now })
      .where(eq(aiTokenLimits.id, limit.id));
    return { id, organizationId: context.organizationId, limitId: limit.id,
      reserved, resetAt: limit.resetAt, startedAt: now.getTime() };
  });
}

export async function settleAITokens(
  reservation: AIReservation,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  status: "success" | "error",
): Promise<void> {
  if (Object.values(usage).some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("Invalid provider token usage");
  }
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-quota:${reservation.organizationId}`}, 0))`);
    const [limit] = await tx.select().from(aiTokenLimits)
      .where(eq(aiTokenLimits.id, reservation.limitId)).for("update");
    const [entry] = await tx.update(aiUsageLogs).set({ ...usage, status,
      durationMs: Date.now() - reservation.startedAt,
      errorMessage: status === "error" ? "Provider rejected the request" : null,
    }).where(and(eq(aiUsageLogs.id, reservation.id), eq(aiUsageLogs.organizationId, reservation.organizationId),
      eq(aiUsageLogs.status, "pending"))).returning({ id: aiUsageLogs.id });
    if (!entry) return; // Already settled: retrying cannot charge/refund a second time.

    // A completion from a previous quota period must not refund the new month's balance.
    if (limit && limit.resetAt?.getTime() === reservation.resetAt?.getTime()) {
      await tx.update(aiTokenLimits).set({
        tokensUsed: sql`greatest(0, ${aiTokenLimits.tokensUsed} - ${reservation.reserved} + ${usage.totalTokens})`,
        updatedAt: new Date(),
      }).where(eq(aiTokenLimits.id, reservation.limitId));
    }
  });
}
