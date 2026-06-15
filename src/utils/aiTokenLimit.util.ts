import { database } from "@/configs/connection.config";
import { aiTokenLimits } from "@/schema/schema";
import { and, eq, isNull } from "drizzle-orm";
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

export const nextMonthReset = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
};

/**
 * Inserts a default org-wide AI token limit.
 * Safe to call multiple times — skips if a limit already exists for the org.
 */
export const insertDefaultAITokenLimit = async (
  orgId: string,
  tokenLimit: number
): Promise<void> => {
  try {
    const existing = await database
      .select({ id: aiTokenLimits.id })
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature)
        )
      )
      .limit(1);

    if (existing.length > 0) return;

    const now = new Date();
    await database.insert(aiTokenLimits).values({
      organizationId: orgId,
      userId: null,
      feature: null,
      tokenLimit,
      tokensUsed: 0,
      period: "monthly",
      resetAt: nextMonthReset(),
      alertThresholdPercent: 80,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    logger.info(`AI token limit (${tokenLimit.toLocaleString()}) set for org ${orgId}`);
  } catch (err) {
    logger.error(`Failed to insert default AI token limit for org ${orgId}:`, err);
  }
};
