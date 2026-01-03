import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  subscriptions,
  subscriptionPlans,
  organizations,
} from "@/schema/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

/**
 * Get complete subscription history for an organization
 * Includes all subscriptions (active, expired, cancelled) ordered by creation date
 */
export const getSubscriptionHistory = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Verify organization exists
    const organization = await database.query.organizations.findFirst({
      where: eq(organizations.id, organizationId),
      columns: {
        id: true,
        name: true,
      },
    });

    if (!organization) {
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    // Get all subscriptions for this organization (ordered by creation date, newest first)
    const allSubscriptions = await database
      .select({
        subscription: subscriptions,
        plan: subscriptionPlans,
      })
      .from(subscriptions)
      .innerJoin(
        subscriptionPlans,
        eq(subscriptions.planId, subscriptionPlans.id)
      )
      .where(eq(subscriptions.organizationId, organizationId))
      .orderBy(desc(subscriptions.createdAt));

    // Format subscription history with plan details
    const subscriptionHistory = allSubscriptions.map(
      ({ subscription, plan }) => {
        // Calculate renewal count from metadata
        const metadata = (subscription.metadata as any) || {};
        const renewalCount = metadata.renewalCount || 0;
        const lastRenewedAt = metadata.lastRenewedAt || null;

        return {
          id: subscription.id,
          planId: subscription.planId,
          planName: plan.name,
          planPrice: plan.price,
          planCurrency: plan.currency || "USD",
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialStart: subscription.trialStart,
          trialEnd: subscription.trialEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          cancelledAt: subscription.cancelledAt,
          createdAt: subscription.createdAt,
          updatedAt: subscription.updatedAt,
          renewalCount: renewalCount,
          lastRenewedAt: lastRenewedAt,
          metadata: subscription.metadata,
          // Plan details
          plan: {
            id: plan.id,
            name: plan.name,
            slug: plan.slug,
            price: plan.price,
            currency: plan.currency,
            billingCycle: plan.billingCycle,
            durationValue: plan.durationValue,
            durationType: plan.durationType,
          },
        };
      }
    );

    logger.info(
      `Retrieved ${subscriptionHistory.length} subscription records for organization ${organizationId}`
    );

    res.status(200).json({
      success: true,
      message: "Subscription history retrieved successfully",
      data: {
        organization: {
          id: organization.id,
          name: organization.name,
        },
        subscriptions: subscriptionHistory,
        totalSubscriptions: subscriptionHistory.length,
        activeSubscriptions: subscriptionHistory.filter(
          (sub) => sub.status === "active"
        ).length,
      },
    });
    return;
  } catch (error) {
    logger.error("Error retrieving subscription history:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while retrieving subscription history",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
    return;
  }
};
