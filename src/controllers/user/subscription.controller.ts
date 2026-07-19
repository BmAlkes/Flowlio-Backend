import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  subscriptions,
  organizations,
  subscriptionPlans,
  userOrganizations,
  users,
} from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import crypto from "crypto";

export const getSubscriptionStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("Subscription status request received");

    const userId = req.user?.id;
    logger.info("User ID:", userId);

    // If no user is authenticated, return no subscription status
    if (!userId) {
      logger.info("No user authenticated, returning not_authenticated status");
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "not_authenticated",
          message: "User not authenticated",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
      return;
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
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "no_organization",
          message: "Organization not found",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
      return;
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
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: false,
          status: "no_subscription",
          message: "No subscription found",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
      return;
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
          trialDays:
            (sub.plan as any).trialDays !== null &&
            (sub.plan as any).trialDays !== undefined
              ? Number((sub.plan as any).trialDays)
              : (sub.plan as any).trial_days !== null &&
                (sub.plan as any).trial_days !== undefined
              ? Number((sub.plan as any).trial_days)
              : 7, // Default to 7 if not found
          isActive: (sub.plan as any).isActive ?? (sub.plan as any).is_active,
          sortOrder:
            (sub.plan as any).sortOrder ?? (sub.plan as any).sort_order,
          createdAt:
            (sub.plan as any).createdAt ?? (sub.plan as any).created_at,
          updatedAt:
            (sub.plan as any).updatedAt ?? (sub.plan as any).updated_at,
        }
      : null;

    // Check if user had a trial that has expired
    const hadTrial =
      sub.subscription.trialStart !== null &&
      sub.subscription.trialEnd !== null;
    const trialExpired =
      hadTrial &&
      sub.subscription.trialEnd !== null &&
      currentDate > sub.subscription.trialEnd;

    // Check if it's currently a trial period
    const isTrial =
      hadTrial &&
      sub.subscription.trialEnd !== null &&
      currentDate <= sub.subscription.trialEnd;

    if (
      sub.subscription.status === "active" &&
      sub.subscription.currentPeriodEnd >= currentDate
    ) {
      logger.info("User has active subscription");

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

      logger.info(`📊 Subscription status check:`, {
        organizationId,
        isTrial,
        trialDaysRemaining,
        trialStart: sub.subscription.trialStart?.toISOString(),
        trialEnd: sub.subscription.trialEnd?.toISOString(),
        currentDate: currentDate.toISOString(),
        planTrialDays: mappedPlan?.trialDays,
      });

      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: "active",
          subscription: {
            ...sub.subscription,
            isTrial: isTrial,
            trialDaysRemaining: trialDaysRemaining,
          },
          plan: mappedPlan,
          message: isTrial
            ? "Active trial subscription"
            : "Active subscription",
          requiresSubscription: false,
          isTrial: isTrial,
          trialDaysRemaining: trialDaysRemaining,
        },
      });
      return;
    } else if (trialExpired) {
      // Trial has expired - redirect to checkout with message
      logger.info("User's trial has expired");
      // Serialize subscription object properly
      const subscriptionResponse = {
        ...sub.subscription,
        trialStart: sub.subscription.trialStart
          ? sub.subscription.trialStart.toISOString()
          : null,
        trialEnd: sub.subscription.trialEnd
          ? sub.subscription.trialEnd.toISOString()
          : null,
        currentPeriodStart: sub.subscription.currentPeriodStart
          ? sub.subscription.currentPeriodStart.toISOString()
          : null,
        currentPeriodEnd: sub.subscription.currentPeriodEnd
          ? sub.subscription.currentPeriodEnd.toISOString()
          : null,
        createdAt: sub.subscription.createdAt
          ? sub.subscription.createdAt.toISOString()
          : null,
        updatedAt: sub.subscription.updatedAt
          ? sub.subscription.updatedAt.toISOString()
          : null,
      };
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: "trial_expired",
          subscription: subscriptionResponse,
          plan: mappedPlan,
          message:
            "Trial period has ended. Please purchase a subscription to continue.",
          requiresSubscription: true,
          redirectTo: "/checkout",
          trialExpired: true,
        },
      });
      return;
    } else if (
      sub.subscription.status === "active" &&
      sub.subscription.currentPeriodEnd < currentDate
    ) {
      logger.info("User has expired subscription");
      // Serialize subscription object properly
      const subscriptionResponse = {
        ...sub.subscription,
        trialStart: sub.subscription.trialStart
          ? sub.subscription.trialStart.toISOString()
          : null,
        trialEnd: sub.subscription.trialEnd
          ? sub.subscription.trialEnd.toISOString()
          : null,
        currentPeriodStart: sub.subscription.currentPeriodStart
          ? sub.subscription.currentPeriodStart.toISOString()
          : null,
        currentPeriodEnd: sub.subscription.currentPeriodEnd
          ? sub.subscription.currentPeriodEnd.toISOString()
          : null,
        createdAt: sub.subscription.createdAt
          ? sub.subscription.createdAt.toISOString()
          : null,
        updatedAt: sub.subscription.updatedAt
          ? sub.subscription.updatedAt.toISOString()
          : null,
      };
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: "expired",
          subscription: subscriptionResponse,
          plan: mappedPlan,
          message: "Subscription expired",
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
      return;
    } else {
      logger.info(
        "User has subscription with status:",
        sub.subscription.status
      );
      // Serialize subscription object properly
      const subscriptionResponse = {
        ...sub.subscription,
        trialStart: sub.subscription.trialStart
          ? sub.subscription.trialStart.toISOString()
          : null,
        trialEnd: sub.subscription.trialEnd
          ? sub.subscription.trialEnd.toISOString()
          : null,
        currentPeriodStart: sub.subscription.currentPeriodStart
          ? sub.subscription.currentPeriodStart.toISOString()
          : null,
        currentPeriodEnd: sub.subscription.currentPeriodEnd
          ? sub.subscription.currentPeriodEnd.toISOString()
          : null,
        createdAt: sub.subscription.createdAt
          ? sub.subscription.createdAt.toISOString()
          : null,
        updatedAt: sub.subscription.updatedAt
          ? sub.subscription.updatedAt.toISOString()
          : null,
      };
      res.status(200).json({
        success: true,
        data: {
          hasSubscription: true,
          status: sub.subscription.status,
          subscription: subscriptionResponse,
          plan: mappedPlan,
          message: `Subscription status: ${sub.subscription.status}`,
          requiresSubscription: true,
          redirectTo: "/pricing", // Redirect to pricing instead of subscription page
        },
      });
      return;
    }
  } catch (error) {
    logger.error("Get subscription status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get subscription status",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
    return;
  }
};

export const getAvailablePlans = async (
  _: Request,
  res: Response
): Promise<void> => {
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

    res.status(200).json({
      success: true,
      data: plans,
    });
    return;
  } catch (error) {
    logger.error("Get available plans error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get available plans",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
    return;
  }
};

export const cancelSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
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
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    const organizationId = userOrg[0].organization.id;

    // Get active subscription
    const existingSubscription = await database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active")
        )
      )
      .limit(1);

    if (!existingSubscription.length) {
      res.status(404).json({
        success: false,
        message: "No active subscription found",
      });
      return;
    }

    const subscription = existingSubscription[0];
    const currentDate = new Date();

    // Check if subscription has already expired
    if (subscription.currentPeriodEnd < currentDate) {
      res.status(400).json({
        success: false,
        message: "Subscription has already expired",
      });
      return;
    }

    // Check if already scheduled for cancellation
    if (subscription.cancelAtPeriodEnd) {
      res.status(400).json({
        success: false,
        message: "Subscription is already scheduled for cancellation",
      });
      return;
    }

    // Set cancelAtPeriodEnd to true (non-refundable)
    await database
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: true,
        cancelledAt: currentDate,
        updatedAt: currentDate,
      })
      .where(eq(subscriptions.id, subscription.id));

    logger.info(
      `Subscription ${subscription.id} scheduled for cancellation at period end for organization ${organizationId}`
    );

    // Get organization and plan details for notification
    const org = userOrg[0].organization;
    const plan = await database.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, subscription.planId),
      columns: {
        name: true,
        price: true,
      },
    });
    const user = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        name: true,
        email: true,
      },
    });

    // Notify super admins about subscription cancellation
    await notifySuperAdmins({
      type: "userUnsubscribe",
      title: "Subscription Cancelled",
      message: `A user has cancelled their subscription. The subscription will remain active until the end of the current billing period.`,
      details: {
        "Organization Name": org.name || "N/A",
        "Organization ID": organizationId,
        "User Name": user?.name || "N/A",
        "User Email": user?.email || "N/A",
        "Plan Name": plan?.name || "N/A",
        "Plan Price": plan?.price ? `$${plan.price}` : "N/A",
        "Subscription ID": subscription.id,
        "Current Period End": subscription.currentPeriodEnd
          .toISOString()
          .split("T")[0],
        "Cancelled At": currentDate.toISOString().split("T")[0],
      },
    });

    res.status(200).json({
      success: true,
      message:
        "Subscription has been cancelled. It will remain active until the end of the current billing period. This action is non-refundable.",
      data: {
        subscriptionId: subscription.id,
        cancelAtPeriodEnd: true,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelledAt: currentDate,
      },
    });
    return;
  } catch (error) {
    logger.error("Cancel subscription error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel subscription",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
    return;
  }
};

export const updateSubscriptionPlan = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { planId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!planId) {
      res.status(400).json({
        success: false,
        message: "Plan ID is required",
      });
      return;
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
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    const organizationId = userOrg[0].organization.id;

    // Check if plan exists
    const plan = await database
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan.length) {
      res.status(404).json({
        success: false,
        message: "Plan not found",
      });
      return;
    }

    const selectedPlan = plan[0];
    const planTrialDays = selectedPlan.trialDays ?? 7; // Use plan's trialDays or default to 7

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

    if (!hasUsedTrial && planTrialDays > 0) {
      // First time - give trial based on plan's trialDays
      trialStartDate = currentDate;
      trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + planTrialDays);
      subscriptionEndDate = trialEndDate;

      logger.info(
        `Starting ${planTrialDays}-day trial for organization ${organizationId} (plan: ${selectedPlan.name})`
      );
    } else {
      // User has already used trial OR plan has no trial (trialDays = 0) - start paid subscription immediately
      subscriptionEndDate = new Date();
      subscriptionEndDate.setMonth(subscriptionEndDate.getMonth() + 1); // 1 month subscription

      logger.info(
        `User has already used trial or plan has no trial - starting paid subscription for organization ${organizationId}`
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

    const isTrial = !hasUsedTrial && planTrialDays > 0;
    const trialDaysRemaining =
      isTrial && trialEndDate
        ? Math.max(
            0,
            Math.ceil(
              (trialEndDate.getTime() - currentDate.getTime()) /
                (1000 * 60 * 60 * 24)
            )
          )
        : 0;

    res.status(200).json({
      success: true,
      message: hasUsedTrial
        ? "Subscription plan updated successfully (paid subscription started)"
        : planTrialDays > 0
        ? `Subscription plan updated successfully (${planTrialDays}-day trial started)`
        : "Subscription plan updated successfully (paid subscription started)",
      data: {
        planId: planId,
        trialStartDate: trialStartDate,
        trialEndDate: trialEndDate,
        subscriptionEndDate: subscriptionEndDate,
        status: "active",
        isTrial: isTrial,
        trialDaysRemaining: trialDaysRemaining,
        planTrialDays: planTrialDays,
      },
    });
    return;
  } catch (error) {
    logger.error("Update subscription plan error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update subscription plan",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
    return;
  }
};
