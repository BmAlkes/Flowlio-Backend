import { database } from "@/configs/connection.config";
import { aiTokenLimits, subscriptionPlans } from "@/schema/schema";
import { and, eq, isNull, asc, sql } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const DEFAULT_PAID_TOKEN_LIMIT = 50_000;
export const DEFAULT_DEMO_TOKEN_LIMIT = 10_000;

export const TOKEN_PACKAGES = [
  {
    id: "tokens_50k",
    tokens: 50_000,
    price: "9.99",
    currency: "USD",
    label: "50,000 tokens",
  },
  {
    id: "tokens_100k",
    tokens: 100_000,
    price: "17.99",
    currency: "USD",
    label: "100,000 tokens",
  },
  {
    id: "tokens_250k",
    tokens: 250_000,
    price: "39.99",
    currency: "USD",
    label: "250,000 tokens",
  },
] as const;

export type TokenPackage = (typeof TOKEN_PACKAGES)[number];

export const getTokenPackageById = (id: string): TokenPackage | undefined =>
  TOKEN_PACKAGES.find((p) => p.id === id) as TokenPackage | undefined;

/**
 * Reads aiTokenLimit from a plan's features.
 * Falls back to DEFAULT_PAID_TOKEN_LIMIT if the plan doesn't define one.
 */
export const getAITokenLimitFromPlan = async (planId: string): Promise<number> => {
  try {
    const [plan] = await database
      .select({ features: subscriptionPlans.features })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    const limit = (plan?.features as any)?.aiTokenLimit;
    if (typeof limit === "number" && limit > 0) return limit;
  } catch (err) {
    logger.error(`Failed to read aiTokenLimit for plan ${planId}:`, err);
  }
  return DEFAULT_PAID_TOKEN_LIMIT;
};

export const nextMonthReset = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
};

type AITransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];

// Caller holds the organization advisory lock. Reuse the canonical record even
// when disabled instead of silently granting a new quota.
export async function ensureOrgAITokenLimit(tx: AITransaction, orgId: string, tokenLimit: number) {
  const [existing] = await tx.select().from(aiTokenLimits).where(and(
    eq(aiTokenLimits.organizationId, orgId), isNull(aiTokenLimits.userId), isNull(aiTokenLimits.feature),
  )).orderBy(asc(aiTokenLimits.createdAt), asc(aiTokenLimits.id)).limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(aiTokenLimits).values({
    organizationId: orgId, userId: null, feature: null, tokenLimit,
    tokensUsed: 0, period: "monthly", resetAt: nextMonthReset(),
    alertThresholdPercent: 80, isActive: true,
  }).returning();
  return created;
}

export const insertDefaultAITokenLimit = async (orgId: string, tokenLimit: number): Promise<void> => {
  await database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-quota:${orgId}`}, 0))`);
    await ensureOrgAITokenLimit(tx, orgId, tokenLimit);
  });
};
