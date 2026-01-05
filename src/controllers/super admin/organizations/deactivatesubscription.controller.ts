import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { subscriptions, organizations } from "@/schema/schema";
import { eq } from "drizzle-orm";

/**
 * Deactivate subscription due to non-payment
 * PUT /api/superadmin/subscriptions/:subscriptionId/deactivate
 */
export const deactivateSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { subscriptionId } = req.params;
    const { reason, notes } = req.body;

    if (!subscriptionId) {
      res.status(400).json({
        success: false,
        message: "Subscription ID is required",
      });
      return;
    }

    logger.info(`Deactivating subscription ${subscriptionId} due to non-payment`);

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

    // Update subscription to cancelled/expired
    await database
      .update(subscriptions)
      .set({
        status: "cancelled",
        updatedAt: now,
        cancelledAt: now,
        metadata: {
          ...metadata,
          manuallyDeactivated: true,
          manuallyDeactivatedAt: now.toISOString(),
          deactivationReason: reason || "Non-payment",
          deactivationNotes: notes || null,
        },
      })
      .where(eq(subscriptions.id, subscriptionId));

    // Update organization status
    await database
      .update(organizations)
      .set({
        subscriptionStatus: "expired",
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    logger.info(
      `✅ Subscription ${subscriptionId} manually deactivated for organization ${organization.id}`
    );

    res.status(200).json({
      success: true,
      message: "Subscription deactivated successfully",
      data: {
        subscriptionId,
        organizationId: organization.id,
        organizationName: organization.name,
        status: "cancelled",
      },
    });
  } catch (error: any) {
    logger.error("Error deactivating subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to deactivate subscription",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

