import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { subscriptionPlans, users } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { activatePlanForOrg } from "@/utils/planActivation.util";

/**
 * Activate a free ($0) plan without going through PayPal.
 * POST /api/subscriptions/activate-free
 */
export const activateFreePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { planId } = req.body;
    const userId = (req as any).user?.id;
    const organizationId = (req as any).user?.organizationId;

    if (!planId) {
      res.status(400).json({ success: false, message: "planId is required" });
      return;
    }

    // Fetch plan
    const [plan] = await database
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ success: false, message: "Plan not found" });
      return;
    }

    if (!plan.isActive) {
      res.status(400).json({ success: false, message: "Plan is not active" });
      return;
    }

    // Enforce free-only
    if (Number(plan.price) > 0) {
      res.status(400).json({
        success: false,
        message: "This plan requires payment. Use the PayPal checkout flow.",
      });
      return;
    }

    // Calculate period based on plan duration
    const now = new Date();
    const durationValue = Number(plan.durationValue) || 1;
    const durationType = String(plan.durationType || "monthly").toLowerCase();
    let periodEnd: Date;

    if (durationType === "days") {
      periodEnd = new Date(now.getTime() + durationValue * 86_400_000);
    } else if (durationType === "yearly" || durationType === "year") {
      periodEnd = new Date(now.getFullYear() + durationValue, now.getMonth(), now.getDate());
    } else {
      // monthly (default)
      periodEnd = new Date(now.getFullYear(), now.getMonth() + durationValue, now.getDate());
    }

    // If no org yet (new user), derive from user's pending data or create org inline
    let orgId = organizationId;

    if (!orgId) {
      // User hasn't completed setup — they'll be handled by the normal onboarding after this
      // Return early with a helpful message
      res.status(400).json({
        success: false,
        message: "No organization found. Complete account setup first.",
      });
      return;
    }

    const { orgName, planName } = await activatePlanForOrg({
      orgId,
      planId,
      periodStart: now,
      periodEnd,
      notes: "Free plan — no payment required",
      assignedBy: userId,
    });

    // Activate user if pending
    if (userId) {
      await database
        .update(users)
        .set({ status: "active", role: "user", isOrganizationOwner: true, selectedPlanId: null, pendingOrganizationData: null })
        .where(eq(users.id, userId));
    }

    logger.info(`Free plan "${planName}" activated for org "${orgName}" (${orgId})`);

    res.status(200).json({
      success: true,
      message: `Plan "${planName}" activated successfully`,
      data: {
        orgId,
        planId,
        planName,
        periodStart: now.toISOString(),
        periodEnd: periodEnd.toISOString(),
        status: "active",
      },
    });
  } catch (error: any) {
    logger.error("activateFreePlan error:", error);
    res.status(500).json({ success: false, message: "Failed to activate plan" });
  }
};
