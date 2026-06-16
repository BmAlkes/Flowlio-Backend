import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { subscriptions, organizations, subscriptionPlans } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { insertDefaultAITokenLimit } from "@/utils/aiTokenLimit.util";
import { DEFAULT_PAID_TOKEN_LIMIT } from "@/utils/aiTokenLimit.util";

/**
 * Assign any plan to an organization without going through PayPal.
 * Used for on-demand / custom / enterprise plans.
 * PUT /api/superadmin/organizations/:orgId/assign-plan
 */
export const assignPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const { planId, startDate, endDate, notes } = req.body;

    if (!orgId || !planId) {
      res.status(400).json({ success: false, message: "orgId and planId are required" });
      return;
    }

    // Verify org exists
    const [org] = await database
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      res.status(404).json({ success: false, message: "Organization not found" });
      return;
    }

    // Verify plan exists
    const [plan] = await database
      .select({ id: subscriptionPlans.id, name: subscriptionPlans.name, features: subscriptionPlans.features })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ success: false, message: "Plan not found" });
      return;
    }

    const now = new Date();
    const periodStart = startDate ? new Date(startDate) : now;
    const periodEnd = endDate
      ? new Date(endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()); // default: 1 month

    // Find existing active subscription for this org
    const [existing] = await database
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, orgId))
      .limit(1);

    if (existing) {
      await database
        .update(subscriptions)
        .set({
          planId,
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          updatedAt: now,
          metadata: {
            assignedManually: true,
            assignedAt: now.toISOString(),
            assignedBy: (req as any).user?.id ?? "superadmin",
            notes: notes ?? null,
          },
        })
        .where(eq(subscriptions.id, existing.id));
    } else {
      await database.insert(subscriptions).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        organizationId: orgId,
        planId,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
        metadata: {
          assignedManually: true,
          assignedAt: now.toISOString(),
          assignedBy: (req as any).user?.id ?? "superadmin",
          notes: notes ?? null,
        },
      });
    }

    // Sync org subscription fields
    await database
      .update(organizations)
      .set({
        subscriptionPlanId: planId,
        subscriptionStatus: "active",
        subscriptionStartDate: periodStart,
        subscriptionEndDate: periodEnd,
        status: "active",
        updatedAt: now,
      })
      .where(eq(organizations.id, orgId));

    // Ensure AI token limit exists — use plan's aiTokenLimit if defined
    const aiTokenLimit =
      typeof plan.features?.aiTokenLimit === "number" && plan.features.aiTokenLimit > 0
        ? plan.features.aiTokenLimit
        : DEFAULT_PAID_TOKEN_LIMIT;
    await insertDefaultAITokenLimit(orgId, aiTokenLimit);

    logger.info(`Plan ${plan.name} manually assigned to org ${org.name} (${orgId})`);

    res.status(200).json({
      success: true,
      message: `Plan "${plan.name}" assigned to "${org.name}"`,
      data: { orgId, planId, periodStart, periodEnd },
    });
  } catch (error: any) {
    logger.error("Error assigning plan:", error);
    res.status(500).json({ success: false, message: "Failed to assign plan" });
  }
};
