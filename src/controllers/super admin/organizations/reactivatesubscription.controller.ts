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
    const { paymentCollected, paymentMethod, paymentAmount, notes } = req.body;

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

    // Update subscription to active
    await database
      .update(subscriptions)
      .set({
        status: "active",
        updatedAt: now,
        metadata: {
          ...metadata,
          manuallyReactivated: true,
          manuallyReactivatedAt: now.toISOString(),
          manualPaymentCollected: paymentCollected || true,
          manualPaymentMethod: paymentMethod || "Manual",
          manualPaymentAmount: paymentAmount || null,
          manualPaymentNotes: notes || null,
          flaggedForReview: false, // Clear review flag
          auditFlagged: false, // Clear audit flag
        },
      })
      .where(eq(subscriptions.id, subscriptionId));

    // Update organization status
    await database
      .update(organizations)
      .set({
        subscriptionStatus: "active",
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
