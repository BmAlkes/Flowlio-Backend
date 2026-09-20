import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import { transaction, reconcileSubscription } from "@/services/subscription-reconciliation.service";
import { enqueue } from "@/services/jobs/queue";
import { Request, Response } from "express";
import { database, connection } from "@/configs/connection.config";
import {
  subscriptions,
  organizations,
  subscriptionPlans,
  userOrganizations,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
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

export const cancelSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (!userId) { res.status(401).json({ success: false, message: "User not authenticated" }); return; }
    if (!organizationId) { res.status(404).json({ success: false, message: "Organization not found" }); return; }
    const subscription = await transaction(connection, async client => {
      const owner = await client.query(`SELECT id FROM user_organizations WHERE user_id=$1 AND organization_id=$2
        AND role='owner' AND status='active'`, [userId, organizationId]);
      if (!owner.rowCount) return null;
      const sub = (await client.query(`SELECT * FROM subscriptions WHERE organization_id=$1
        AND status IN ('active','past_due') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [organizationId])).rows[0];
      if (!sub) return undefined;
      if (sub.paypal_subscription_id) {
        await client.query(`UPDATE subscriptions SET metadata=COALESCE(metadata::jsonb,'{}'::jsonb) ||
          jsonb_build_object('cancellationRequestedAt',COALESCE(metadata->>'cancellationRequestedAt',now()::text)),updated_at=now() WHERE id=$1`, [sub.id]);
        await enqueue(client, "subscription-reconcile", "cancel:" + sub.paypal_subscription_id, { providerId: sub.paypal_subscription_id });
      } else {
        await client.query("UPDATE subscriptions SET cancel_at_period_end=true,cancelled_at=COALESCE(cancelled_at,now()),updated_at=now() WHERE id=$1", [sub.id]);
      }
      return sub;
    });
    if (subscription === null) { res.status(403).json({ success: false, message: "Only the organization owner can cancel" }); return; }
    if (!subscription) { res.status(404).json({ success: false, message: "No active subscription found" }); return; }
    if (subscription.paypal_subscription_id) {
      await transaction(connection, client => reconcileSubscription(client, subscription.paypal_subscription_id));
    }
    if (!subscription.cancel_at_period_end) {
      void notifySuperAdmins({
        type: "userUnsubscribe", title: "Subscription Cancelled",
        message: "Subscription cancelled. Access remains available until the end of the paid period.",
        details: { "Organization ID": organizationId, "Subscription ID": subscription.id },
      }).catch(() => logger.error("Subscription cancellation notification failed"));
    }
    res.status(200).json({ success: true,
      message: "Subscription cancelled. Access remains available until the end of the paid period.",
      data: { subscriptionId: subscription.id, cancelAtPeriodEnd: true,
        currentPeriodEnd: subscription.current_period_end, cancelledAt: new Date() } });
  } catch (error) {
    logger.error("Subscription cancellation awaiting reconciliation", { error: error instanceof Error ? error.name : "Error" });
    res.status(503).json({ success: false, message: "Cancellation could not be confirmed yet. Please retry shortly." });
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
