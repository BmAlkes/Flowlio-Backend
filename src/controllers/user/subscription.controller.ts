import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  subscriptions,
  organizations,
  subscriptionPlans,
  userOrganizations,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import crypto from "crypto";

export const getSubscriptionStatus = async (req: Request, res: Response) => {
  try {
    logger.info("Subscription status request received");
    logger.info("Request headers:", req.headers);
    logger.info("Request user:", req.user);

    const userId = req.user?.id;
    logger.info("User ID:", userId);

    // If no user is authenticated, return no subscription status
    if (!userId) {
      logger.info("No user authenticated, returning not_authenticated status");
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "not_authenticated",
          message: "User not authenticated",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
    }

    // Get user's organization through user_organizations table
    const userOrg = await database
      .select({
        organization: organizations,
      })
      .from(organizations)
      .innerJoin(
        userOrganizations,
        eq(organizations.id, userOrganizations.organizationId)
      )
      .where(eq(userOrganizations.userId, userId))
      .limit(1);

    if (!userOrg.length) {
      logger.info("No organization found for user");
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "no_organization",
          message: "Organization not found",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
    }

    const organizationId = userOrg[0].organization.id;

    // Check subscription status
    const subscription = await database
      .select({
        subscription: subscriptions,
        plan: subscriptionPlans,
      })
      .from(subscriptions)
      .leftJoin(
        subscriptionPlans,
        eq(subscriptions.planId, subscriptionPlans.id)
      )
      .where(eq(subscriptions.organizationId, organizationId))
      .orderBy(subscriptions.createdAt)
      .limit(1);

    if (!subscription.length) {
      logger.info("No subscription found for user");
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "no_subscription",
          message: "No subscription found",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
    }

    const sub = subscription[0];
    const currentDate = new Date();

    // Map plan to ensure camelCase naming
    const mappedPlan = sub.plan
      ? {
          ...sub.plan,
          customPlanName:
            (sub.plan as any).customPlanName ??
            (sub.plan as any).custom_plan_name ??
            null,
          billingCycle:
            (sub.plan as any).billingCycle ?? (sub.plan as any).billing_cycle,
          durationValue:
            (sub.plan as any).durationValue ?? (sub.plan as any).duration_value,
          durationType:
            (sub.plan as any).durationType ?? (sub.plan as any).duration_type,
          isActive: (sub.plan as any).isActive ?? (sub.plan as any).is_active,
          sortOrder:
            (sub.plan as any).sortOrder ?? (sub.plan as any).sort_order,
          createdAt:
            (sub.plan as any).createdAt ?? (sub.plan as any).created_at,
          updatedAt:
            (sub.plan as any).updatedAt ?? (sub.plan as any).updated_at,
        }
      : null;

    if (
      sub.subscription.status === "active" &&
      sub.subscription.currentPeriodEnd >= currentDate
    ) {
      logger.info("User has active subscription");

      // Check if it's a trial period
      const isTrial =
        sub.subscription.trialStart !== null &&
        sub.subscription.trialEnd !== null &&
        currentDate <= sub.subscription.trialEnd;

      const trialDaysRemaining =
        isTrial && sub.subscription.trialEnd
          ? Math.max(
              0,
              Math.ceil(
                (sub.subscription.trialEnd.getTime() - currentDate.getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            )
          : 0;

      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: "active",
          subscription: sub.subscription,
          plan: mappedPlan,
          message: isTrial
            ? "Active trial subscription"
            : "Active subscription",
          requiresSubscription: false,
          isTrial: isTrial,
          trialDaysRemaining: trialDaysRemaining,
        },
      });
    } else if (
      sub.subscription.status === "active" &&
      sub.subscription.currentPeriodEnd < currentDate
    ) {
      logger.info("User has expired subscription");
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: "expired",
          subscription: sub.subscription,
          plan: mappedPlan,
          message: "Subscription expired",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
    } else {
      logger.info(
        "User has subscription with status:",
        sub.subscription.status
      );
      return res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: sub.subscription.status,
          subscription: sub.subscription,
          plan: mappedPlan,
          message: `Subscription status: ${sub.subscription.status}`,
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
    }
  } catch (error) {
    logger.error("Get subscription status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get subscription status",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

export const getAvailablePlans = async (_: Request, res: Response) => {
  try {
    // Use query API to get plans, then map to ensure consistent structure
    const plansData = await database.query.subscriptionPlans.findMany({
      where: eq(subscriptionPlans.isActive, true),
      orderBy: (plans, { asc }) => [asc(plans.sortOrder), asc(plans.name)],
    });

    // Map to ensure camelCase naming and consistent structure
    // Handle both snake_case (from DB) and camelCase (from schema)
    const plans = plansData.map((plan: any) => ({
      id: plan.id,
      name: plan.name,
      slug: plan.slug,
      description: plan.description,
      customPlanName: plan.customPlanName ?? plan.custom_plan_name ?? null,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle ?? plan.billing_cycle,
      durationValue: plan.durationValue ?? plan.duration_value,
      durationType: plan.durationType ?? plan.duration_type,
      features: plan.features,
      isActive: plan.isActive ?? plan.is_active,
      sortOrder: plan.sortOrder ?? plan.sort_order,
      createdAt: plan.createdAt ?? plan.created_at,
      updatedAt: plan.updatedAt ?? plan.updated_at,
    }));

    logger.info("Retrieved available plans:", {
      count: plans.length,
      sample: plans[0]
        ? {
            name: plans[0].name,
            durationValue: plans[0].durationValue,
            durationType: plans[0].durationType,
            customPlanName: plans[0].customPlanName,
            allKeys: Object.keys(plans[0]),
          }
        : null,
    });

    return res.status(200).json({
      success: true,
      data: plans,
    });
  } catch (error) {
    logger.error("Get available plans error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get available plans",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

export const updateSubscriptionPlan = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { planId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Plan ID is required",
      });
    }

    // Get user's organization
    const userOrg = await database
      .select({
        organization: organizations,
      })
      .from(organizations)
      .innerJoin(
        userOrganizations,
        eq(organizations.id, userOrganizations.organizationId)
      )
      .where(eq(userOrganizations.userId, userId))
      .limit(1);

    if (!userOrg.length) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    const organizationId = userOrg[0].organization.id;

    // Check if plan exists
    const plan = await database
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan.length) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    // Check if user has already used their trial
    const existingSubscription = await database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1);

    const currentDate = new Date();
    let trialStartDate = null;
    let trialEndDate = null;
    let subscriptionEndDate = null;

    // Check if user has already used trial
    const hasUsedTrial =
      existingSubscription.length > 0 &&
      (existingSubscription[0].trialStart !== null ||
        existingSubscription[0].trialEnd !== null);

    if (!hasUsedTrial) {
      // First time - give 7-day trial
      trialStartDate = currentDate;
      trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 7);
      subscriptionEndDate = trialEndDate;

      logger.info(`Starting 7-day trial for organization ${organizationId}`);
    } else {
      // User has already used trial - start paid subscription immediately
      subscriptionEndDate = new Date();
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1); // 1 month subscription

      logger.info(
        `User has already used trial - starting paid subscription for organization ${organizationId}`
      );
    }

    if (existingSubscription.length > 0) {
      // Update existing subscription
      await database
        .update(subscriptions)
        .set({
          planId: planId,
          status: "active",
          currentPeriodStart: currentDate,
          currentPeriodEnd: subscriptionEndDate,
          trialStart: trialStartDate,
          trialEnd: trialEndDate,
          updatedAt: currentDate,
        })
        .where(eq(subscriptions.organizationId, organizationId));
    } else {
      // Create new subscription
      await database.insert(subscriptions).values({
        id: crypto.randomUUID(),
        organizationId: organizationId,
        planId: planId,
        status: "active",
        currentPeriodStart: currentDate,
        currentPeriodEnd: subscriptionEndDate,
        trialStart: trialStartDate,
        trialEnd: trialEndDate,
        createdAt: currentDate,
        updatedAt: currentDate,
      });
    }

    logger.info(
      `Subscription updated for organization ${organizationId} to plan ${planId}`
    );

    return res.status(200).json({
      success: true,
      message: hasUsedTrial
        ? "Subscription plan updated successfully (paid subscription started)"
        : "Subscription plan updated successfully (7-day trial started)",
      data: {
        planId: planId,
        trialStartDate: trialStartDate,
        trialEndDate: trialEndDate,
        subscriptionEndDate: subscriptionEndDate,
        status: "active",
        isTrial: !hasUsedTrial,
        trialDaysRemaining: !hasUsedTrial ? 7 : 0,
      },
    });
  } catch (error) {
    logger.error("Update subscription plan error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update subscription plan",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
