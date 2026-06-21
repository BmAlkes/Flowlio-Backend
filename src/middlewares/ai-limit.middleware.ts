import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import { aiTokenLimits, aiUsageAlerts, aiUsageLogs, notifications, userOrganizations } from "@/schema/schema";
import { eq, and, isNull, gte, sql } from "drizzle-orm";
import {
  insertDefaultAITokenLimit,
  DEFAULT_PAID_TOKEN_LIMIT,
} from "@/utils/aiTokenLimit.util";
import { logger } from "@/utils/logger.util";

export const checkAITokenLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const orgId = req.user?.organizationId;
    const userId = (req.user as any)?.id as string | undefined;

    if (!orgId) {
      next();
      return;
    }

    // ── 1. Org-wide limit check ──
    const limits = await database
      .select()
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature),
          eq(aiTokenLimits.isActive, true)
        )
      )
      .limit(1);

    if (limits.length === 0) {
      await insertDefaultAITokenLimit(orgId, DEFAULT_PAID_TOKEN_LIMIT);
      next();
      return;
    }

    const record = limits[0];

    if (record.tokensUsed >= record.tokenLimit) {
      // Fire-and-forget: create quota_exceeded notification for org admins
      createOrgNotification(orgId, "ai_quota_exceeded", "AI token limit reached",
        `Your organization has used all ${record.tokenLimit.toLocaleString()} AI tokens this month.`);

      res.status(429).json({
        success: false,
        error: "ORG_TOKEN_LIMIT_EXCEEDED",
        message: "AI token limit exceeded for this organization",
        tokensUsed: record.tokensUsed,
        tokenLimit: record.tokenLimit,
      });
      return;
    }

    // ── 2. Alert threshold check (org-wide) ──
    const usagePercent = (record.tokensUsed / record.tokenLimit) * 100;
    if (usagePercent >= record.alertThresholdPercent) {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [existingAlert] = await database
        .select({ id: aiUsageAlerts.id })
        .from(aiUsageAlerts)
        .where(
          and(
            eq(aiUsageAlerts.organizationId, orgId),
            eq(aiUsageAlerts.alertType, "threshold_80"),
            gte(aiUsageAlerts.createdAt, monthStart)
          )
        )
        .limit(1);

      if (!existingAlert) {
        await database.insert(aiUsageAlerts).values({
          alertType: "threshold_80",
          organizationId: orgId,
          userId: null,
          tokensUsed: record.tokensUsed,
          tokenLimit: record.tokenLimit,
          isRead: false,
        });

        createOrgNotification(orgId, "ai_threshold_reached",
          `AI usage at ${Math.round(usagePercent)}%`,
          `Your organization has used ${record.tokensUsed.toLocaleString()} of ${record.tokenLimit.toLocaleString()} AI tokens.`);
      }
    }

    // ── 3. Per-user limit check ──
    if (userId) {
      const [userLimit] = await database
        .select()
        .from(aiTokenLimits)
        .where(
          and(
            eq(aiTokenLimits.organizationId, orgId),
            eq(aiTokenLimits.userId, userId),
            isNull(aiTokenLimits.feature),
            eq(aiTokenLimits.isActive, true)
          )
        )
        .limit(1);

      if (userLimit && userLimit.tokenLimit > 0) {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const [usage] = await database
          .select({ total: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)` })
          .from(aiUsageLogs)
          .where(
            and(
              eq(aiUsageLogs.organizationId, orgId),
              eq(aiUsageLogs.userId, userId),
              eq(aiUsageLogs.status, "success"),
              gte(aiUsageLogs.createdAt, monthStart)
            )
          );

        const userTokensUsed = Number(usage?.total ?? 0);

        if (userTokensUsed >= userLimit.tokenLimit) {
          res.status(403).json({
            success: false,
            error: "USER_TOKEN_LIMIT_EXCEEDED",
            message: "You've reached your personal AI token limit for this month.",
            tokensUsed: userTokensUsed,
            tokenLimit: userLimit.tokenLimit,
          });
          return;
        }
      }
    }

    next();
  } catch (err) {
    logger.error("checkAITokenLimit error:", err);
    next();
  }
};

// ── helpers ───────────────────────────────────────────────────────────────────

function createOrgNotification(
  orgId: string,
  type: string,
  title: string,
  message: string
): void {
  database
    .select({ userId: userOrganizations.userId })
    .from(userOrganizations)
    .where(and(eq(userOrganizations.organizationId, orgId), eq(userOrganizations.role, "owner")))
    .limit(1)
    .then(([owner]) => {
      if (!owner) return;
      return database.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: owner.userId,
        organizationId: orgId,
        type,
        title,
        message,
        read: false,
      });
    })
    .catch((err) => logger.error("createOrgNotification failed:", err));
}
