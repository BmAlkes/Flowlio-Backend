import { Request, Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import { aiTokenLimits, aiUsageAlerts } from "@/schema/schema";
import { eq, and, isNull, gte } from "drizzle-orm";

export const checkAITokenLimit = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Step 1 — Extract identifiers
    const orgId = req.user?.organizationId;

    if (!orgId) {
      next();
      return;
    }

    // Step 2 — Fetch org-wide limit (no userId, no feature scoping)
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

    // Step 3 — No limit record found, allow through
    if (limits.length === 0) {
      next();
      return;
    }

    const record = limits[0];

    // Step 4 — Hard limit: block request
    if (record.tokensUsed >= record.tokenLimit) {
      res
        .status(429)
        .json({ error: "AI token limit exceeded for this organization" });
      return;
    }

    // Step 5 — Alert threshold check
    if (
      record.tokensUsed >=
      (record.tokenLimit * record.alertThresholdPercent) / 100
    ) {
      const now = new Date();
      const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const existingAlert = await database
        .select()
        .from(aiUsageAlerts)
        .where(
          and(
            eq(aiUsageAlerts.organizationId, orgId),
            eq(aiUsageAlerts.alertType, "threshold_80"),
            gte(aiUsageAlerts.createdAt, firstDayOfMonth)
          )
        )
        .limit(1);

      if (existingAlert.length === 0) {
        await database.insert(aiUsageAlerts).values({
          alertType: "threshold_80",
          organizationId: orgId,
          userId: null,
          tokensUsed: record.tokensUsed,
          tokenLimit: record.tokenLimit,
          isRead: false,
        });
      }
    }

    // Step 6 — All checks passed
    next();
  } catch (err) {
    console.error("checkAITokenLimit error:", err);
    next();
  }
};
