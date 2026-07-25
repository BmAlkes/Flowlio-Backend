import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { subscriptions, organizations } from "@/schema/schema";
import { eq } from "drizzle-orm";

/**
 * Reactivate subscription after manual payment collection
 * PUT /api/superadmin/subscriptions/:subscriptionId/reactivate
 */
export const reactivateSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const { paymentCollected, paymentMethod, paymentAmount, notes, newPeriodEnd } = req.body;

    if (!subscriptionId) {
      res.status(400).json({
        success: false,
        message: "Subscription ID is required",
      });
      return;
    }

    logger.info(
      `Reactivating subscription ${subscriptionId} after manual payment collection`
    );

    // Find the subscription
    const subscription = await database.query.subscriptions.findFirst({
      where: (subs, { eq }) => eq(subs.id, subscriptionId),
      with: { plan: true },
    });

    if (!subscription) {
      res.status(404).json({
        success: false,
        message: "Subscription not found",
      });
      return;
    }

    // Get organization
    const organization = await database.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.id, subscription.organizationId),
    });

    if (!organization) {
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    const now = new Date();
    const metadata = (subscription.metadata as any) || {};

    // Compute the new period end: use provided date, or extend from now by the plan's duration.
    // This is required because the middleware blocks access when currentPeriodEnd is in the past.
    let periodEnd: Date;
    if (newPeriodEnd) {
      periodEnd = new Date(newPeriodEnd);
    } else {
      const plan = (subscription as any).plan;
      const durationValue = Number(plan?.durationValue) || 1;
      const durationType = String(plan?.durationType || "monthly").toLowerCase();
      let periodMs = 30 * 24 * 60 * 60 * 1000;
      if (durationType === "days") {
        periodMs = durationValue * 24 * 60 * 60 * 1000;
      } else if (durationType === "yearly" || durationType === "year") {
        periodMs = durationValue * 365 * 24 * 60 * 60 * 1000;
      } else {
        periodMs = durationValue * 30 * 24 * 60 * 60 * 1000;
      }
      periodEnd = new Date(now.getTime() + periodMs);
    }

    // Update subscription to active with an extended period
    await database
      .update(subscriptions)
      .set({
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        updatedAt: now,
        metadata: {
          ...metadata,
          manuallyReactivated: true,
          manuallyReactivatedAt: now.toISOString(),
          manualPaymentCollected: paymentCollected || true,
          manualPaymentMethod: paymentMethod || "Manual",
          manualPaymentAmount: paymentAmount || null,
          manualPaymentNotes: notes || null,
          flaggedForReview: false,
          auditFlagged: false,
        },
      })
      .where(eq(subscriptions.id, subscriptionId));

    // Update organization status and dates
    await database
      .update(organizations)
      .set({
        subscriptionStatus: "active",
        subscriptionStartDate: now,
        subscriptionEndDate: periodEnd,
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    logger.info(
      `✅ Subscription ${subscriptionId} manually reactivated for organization ${organization.id}`
    );

    res.status(200).json({
      success: true,
      message: "Subscription reactivated successfully",
      data: {
        subscriptionId,
        organizationId: organization.id,
        organizationName: organization.name,
        status: "active",
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error("Error reactivating subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reactivate subscription",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
