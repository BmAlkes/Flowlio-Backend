import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";
import axios from "axios";
import {
  organizations,
  userOrganizations,
  subscriptions,
  subscriptionPlans,
  users,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import { getPayPalAccessToken, getPayPalBaseURL } from "@/utils/paypal.util";
import {
  insertDefaultAITokenLimit,
  DEFAULT_PAID_TOKEN_LIMIT,
  getAITokenLimitFromPlan,
} from "@/utils/aiTokenLimit.util";

// ── Billing plan setup ────────────────────────────────────────────────────────

function getBillingFrequency(plan: typeof subscriptionPlans.$inferSelect) {
  const type = String(plan.durationType || "monthly").toLowerCase().trim();
  const value = Number(plan.durationValue) || 1;

  if (type === "yearly" || type === "year") {
    return { interval_unit: "YEAR", interval_count: value };
  }
  // Default: monthly billing
  return { interval_unit: "MONTH", interval_count: value };
}

async function ensurePayPalBillingPlan(
  plan: typeof subscriptionPlans.$inferSelect
): Promise<string> {
  if (plan.paypalPlanId) return plan.paypalPlanId;

  const accessToken = await getPayPalAccessToken();
  const baseURL = getPayPalBaseURL();

  // Ensure product exists
  let productId = plan.paypalProductId ?? null;
  if (!productId) {
    const productRes = await axios.post(
      `${baseURL}/v1/catalogs/products`,
      {
        name: "Flowlio",
        description: "Flowlio project management platform",
        type: "SERVICE",
        category: "SOFTWARE",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );
    productId = productRes.data.id as string;

    await database
      .update(subscriptionPlans)
      .set({ paypalProductId: productId, updatedAt: new Date() })
      .where(eq(subscriptionPlans.id, plan.id));

    logger.info(`Created PayPal product ${productId} for plan ${plan.id}`);
  }

  // Create billing plan
  const billingRes = await axios.post(
    `${baseURL}/v1/billing/plans`,
    {
      product_id: productId,
      name: `Flowlio – ${plan.name}`,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: getBillingFrequency(plan),
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0, // indefinite
          pricing_scheme: {
            fixed_price: {
              value: Number(plan.price).toFixed(2),
              currency_code: plan.currency || "USD",
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 3,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  const paypalPlanId = billingRes.data.id as string;

  await database
    .update(subscriptionPlans)
    .set({ paypalPlanId, updatedAt: new Date() })
    .where(eq(subscriptionPlans.id, plan.id));

  logger.info(
    `Created PayPal billing plan ${paypalPlanId} for plan ${plan.id} (${plan.name})`
  );

  return paypalPlanId;
}

// ── POST /payments/paypal/create-subscription ─────────────────────────────────

export const createPayPalSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { planId } = req.body as { planId: string };

    if (!planId) {
      res.status(400).json({ success: false, message: "planId is required" });
      return;
    }

    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      res.status(503).json({
        success: false,
        message: "PayPal is not configured on the server.",
        code: "PAYPAL_NOT_CONFIGURED",
      });
      return;
    }

    const plan = await database.query.subscriptionPlans.findFirst({
      where: (plans, { eq, and }) =>
        and(eq(plans.id, planId), eq(plans.isActive, true)),
    });

    if (!plan) {
      res.status(404).json({ success: false, message: "Plan not found or inactive" });
      return;
    }

    const paypalPlanId = await ensurePayPalBillingPlan(plan);

    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const subRes = await axios.post(
      `${baseURL}/v1/billing/subscriptions`,
      {
        plan_id: paypalPlanId,
        application_context: {
          brand_name: "Flowlio",
          locale: "en-US",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${env.FRONTEND_DOMAIN}/checkout`,
          cancel_url: `${env.FRONTEND_DOMAIN}/checkout`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
      }
    );

    const subscriptionId: string = subRes.data.id;

    logger.info(
      `Created PayPal subscription ${subscriptionId} for plan ${plan.id}`
    );

    res.status(200).json({
      success: true,
      data: { subscriptionId },
    });
  } catch (error: any) {
    logger.error("Error creating PayPal subscription:", {
      error: error.message,
      response: error.response?.data,
    });
    res.status(500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to create PayPal subscription",
    });
  }
};

// ── POST /payments/paypal/activate-subscription ───────────────────────────────

interface ActivateSubscriptionBody {
  subscriptionId: string;
  userId?: string;
  organizationName?: string;
  organizationWebsite?: string;
  organizationIndustry?: string;
  organizationSize?: string;
  planId?: string;
}

export const activatePayPalSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    subscriptionId,
    userId,
    organizationName,
    organizationWebsite,
    organizationIndustry,
    organizationSize,
    planId: bodyPlanId,
  } = req.body as ActivateSubscriptionBody;

  if (!subscriptionId) {
    res.status(400).json({ success: false, message: "subscriptionId is required" });
    return;
  }

  try {
    // Verify subscription status with PayPal
    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const subDetails = await axios.get(
      `${baseURL}/v1/billing/subscriptions/${subscriptionId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const paypalStatus: string = subDetails.data.status;
    const paypalPlanId: string = subDetails.data.plan_id;

    logger.info(
      `PayPal subscription ${subscriptionId} status: ${paypalStatus}, plan: ${paypalPlanId}`
    );

    // Accept ACTIVE or APPROVAL_PENDING (webhook confirms later)
    if (paypalStatus !== "ACTIVE" && paypalStatus !== "APPROVAL_PENDING") {
      res.status(400).json({
        success: false,
        message: `PayPal subscription is not active. Status: ${paypalStatus}`,
        code: "SUBSCRIPTION_NOT_ACTIVE",
      });
      return;
    }

    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required" });
      return;
    }

    // Get user data
    const userData = await database.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, userId),
    });

    if (!userData) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const pendingData = userData.pendingOrganizationData as {
      organizationName?: string;
      organizationWebsite?: string;
      organizationIndustry?: string;
      organizationSize?: string;
      planId?: string;
    } | null;

    const finalPlanId =
      bodyPlanId || userData.selectedPlanId || pendingData?.planId;

    if (!finalPlanId) {
      res.status(400).json({ success: false, message: "Plan ID is required" });
      return;
    }

    const plan = await database.query.subscriptionPlans.findFirst({
      where: (plans, { eq, and }) =>
        and(eq(plans.id, finalPlanId), eq(plans.isActive, true)),
    });

    if (!plan) {
      res.status(404).json({ success: false, message: "Plan not found or inactive" });
      return;
    }

    // Calculate subscription period
    const now = new Date();
    let periodMs = 30 * 24 * 60 * 60 * 1000;
    const durationValue = Number(plan.durationValue);
    const durationType = String(plan.durationType || "monthly").toLowerCase();

    if (!isNaN(durationValue) && durationValue > 0) {
      if (durationType === "days") {
        periodMs = durationValue * 24 * 60 * 60 * 1000;
      } else if (durationType === "yearly" || durationType === "year") {
        periodMs = durationValue * 365 * 24 * 60 * 60 * 1000;
      } else {
        periodMs = durationValue * 30 * 24 * 60 * 60 * 1000;
      }
    }

    // Use PayPal's next billing time if available
    const nextBillingTimeStr =
      subDetails.data.billing_info?.next_billing_time as string | undefined;
    const subscriptionEndDate = nextBillingTimeStr
      ? new Date(nextBillingTimeStr)
      : new Date(now.getTime() + periodMs);

    const subscriptionMetadata = {
      paypalSubscriptionId: subscriptionId,
      paypalPlanId,
      activatedAt: now.toISOString(),
      paymentMethod: "PayPal Subscription",
    };

    // Check if user already has an org
    const existingUserOrg = await database.query.userOrganizations.findFirst({
      where: (userOrgs, { eq }) => eq(userOrgs.userId, userId),
      with: { organization: true },
    });

    let orgId: string;
    let dbSubscriptionId: string;

    if (existingUserOrg?.organization) {
      // Update existing org and subscription
      orgId = existingUserOrg.organization.id;
      const orgSettings = existingUserOrg.organization.settings as any || {};
      const isDemoOrg = orgSettings?.demo === true;

      let updatedSettings = { ...orgSettings };
      if (isDemoOrg) {
        delete updatedSettings.demo;
        delete updatedSettings.demoCreatedAt;
        delete updatedSettings.demoCreatedBy;
        delete updatedSettings.demoRole;
      }

      const existingSub = await database.query.subscriptions.findFirst({
        where: (subs, { eq }) => eq(subs.organizationId, orgId),
      });

      if (existingSub) {
        dbSubscriptionId = existingSub.id;
        await database
          .update(subscriptions)
          .set({
            planId: finalPlanId,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: subscriptionEndDate,
            cancelAtPeriodEnd: false,
            updatedAt: now,
            metadata: { ...(existingSub.metadata as any || {}), ...subscriptionMetadata },
          })
          .where(eq(subscriptions.id, dbSubscriptionId));
      } else {
        dbSubscriptionId = crypto.randomUUID().replace(/-/g, "");
        await database.insert(subscriptions).values({
          id: dbSubscriptionId,
          organizationId: orgId,
          planId: finalPlanId,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: subscriptionEndDate,
          cancelAtPeriodEnd: false,
          createdAt: now,
          updatedAt: now,
          metadata: subscriptionMetadata,
        });
      }

      await database
        .update(organizations)
        .set({
          status: "active",
          subscriptionStatus: "active",
          subscriptionPlanId: finalPlanId,
          subscriptionStartDate: now,
          subscriptionEndDate,
          settings: updatedSettings,
          updatedAt: now,
        })
        .where(eq(organizations.id, orgId));
    } else {
      // Create new org
      const finalOrgName =
        organizationName ||
        pendingData?.organizationName ||
        `${userData.email.split("@")[0]}'s Organization`;

      const baseSlug = finalOrgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const slug = `${baseSlug}-${userId.substring(0, 8)}`;

      orgId = crypto.randomUUID().replace(/-/g, "");
      dbSubscriptionId = crypto.randomUUID().replace(/-/g, "");

      await database.insert(organizations).values({
        id: orgId,
        name: finalOrgName,
        slug,
        status: "active",
        subscriptionStatus: "active",
        subscriptionPlanId: finalPlanId,
        subscriptionStartDate: now,
        subscriptionEndDate,
        createdAt: now,
        updatedAt: now,
        website: organizationWebsite || pendingData?.organizationWebsite,
        industry: organizationIndustry || pendingData?.organizationIndustry,
        size: organizationSize || pendingData?.organizationSize,
      });

      await database.insert(userOrganizations).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        userId,
        organizationId: orgId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });

      await database.insert(subscriptions).values({
        id: dbSubscriptionId,
        organizationId: orgId,
        planId: finalPlanId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: subscriptionEndDate,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
        metadata: subscriptionMetadata,
      });
    }

    // Assign default AI token limit — use plan's aiTokenLimit if defined
    const aiLimit = finalPlanId
      ? await getAITokenLimitFromPlan(finalPlanId)
      : DEFAULT_PAID_TOKEN_LIMIT;
    await insertDefaultAITokenLimit(orgId, aiLimit);

    // Activate user
    await database
      .update(users)
      .set({
        status: "active",
        role: "user",
        isOrganizationOwner: true,
        selectedPlanId: null,
        pendingOrganizationData: null,
      })
      .where(eq(users.id, userId));

    logger.info(
      `✅ PayPal subscription ${subscriptionId} activated for org ${orgId}, user ${userId}`
    );

    notifySuperAdmins({
      type: "userSubscribe",
      title: "New Subscription Activated",
      message: `New PayPal subscription activated for organization "${existingUserOrg?.organization?.name || organizationName || "New Org"}".`,
      details: {
        "Subscription ID": subscriptionId,
        "Plan Name": plan.name,
        "Plan Price": `${plan.price} ${plan.currency}`,
        "User Email": userData.email,
        "Activated At": now.toISOString().split("T")[0],
      },
    }).catch(() => {});

    res.status(200).json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        subscriptionId,
        status: "ACTIVE",
        organizationId: orgId,
        subscription: { id: dbSubscriptionId, planId: finalPlanId },
        plan: { id: plan.id, name: plan.name },
      },
    });
  } catch (error: any) {
    logger.error("Error activating PayPal subscription:", {
      error: error.message,
      response: error.response?.data,
    });
    res.status(500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to activate subscription",
    });
  }
};

// ── Webhook signature verification ────────────────────────────────────────────

async function verifyPayPalWebhookSignature(
  req: Request,
  rawBody: string
): Promise<boolean> {
  try {
    const webhookId = env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn("PAYPAL_WEBHOOK_ID not set — skipping signature verification");
      return true; // allow through if not configured yet
    }

    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const response = await axios.post(
      `${baseURL}/v1/notifications/verify-webhook-signature`,
      {
        auth_algo: req.headers["paypal-auth-algo"],
        cert_url: req.headers["paypal-cert-url"],
        transmission_id: req.headers["paypal-transmission-id"],
        transmission_sig: req.headers["paypal-transmission-sig"],
        transmission_time: req.headers["paypal-transmission-time"],
        webhook_id: webhookId,
        webhook_event: JSON.parse(rawBody),
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data?.verification_status === "SUCCESS";
  } catch (error: any) {
    logger.error("PayPal webhook signature verification failed:", error.message);
    return false;
  }
}

// ── POST /payments/paypal/webhook ─────────────────────────────────────────────

export const handlePayPalWebhook = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Verify the request actually came from PayPal
    const rawBody =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const isValid = await verifyPayPalWebhookSignature(req, rawBody);
    if (!isValid) {
      logger.warn("PayPal webhook signature verification failed — rejected");
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType: string = event.event_type;

    logger.info(`PayPal webhook received: ${eventType}`, {
      resourceId: event.resource?.id,
    });

    switch (eventType) {
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const subId = event.resource?.id as string;
        if (subId) {
          // Ensure subscription DB record is marked active
          await syncSubscriptionFromPayPal(subId);
        }
        break;
      }

      case "BILLING.SUBSCRIPTION.PAYMENT.COMPLETED": {
        const subId = event.resource?.id as string;
        if (subId) {
          await syncSubscriptionFromPayPal(subId);
        }
        break;
      }

      case "BILLING.SUBSCRIPTION.SUSPENDED":
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.EXPIRED": {
        const subId = event.resource?.id as string;
        if (subId) {
          await markSubscriptionByPayPalId(subId, "cancelled");
        }
        break;
      }

      default:
        logger.info(`Unhandled PayPal webhook event: ${eventType}`);
    }

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error("Error handling PayPal webhook:", error);
    res.status(500).json({ success: false, message: "Webhook processing failed" });
  }
};

async function syncSubscriptionFromPayPal(paypalSubscriptionId: string) {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const subDetails = await axios.get(
      `${baseURL}/v1/billing/subscriptions/${paypalSubscriptionId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    const status: string = subDetails.data.status;
    const nextBillingTimeStr = subDetails.data.billing_info
      ?.next_billing_time as string | undefined;
    const nextPeriodEnd = nextBillingTimeStr
      ? new Date(nextBillingTimeStr)
      : null;

    if (status !== "ACTIVE") return;

    // Find subscription in DB by paypalSubscriptionId in metadata
    const allSubs = await database.query.subscriptions.findMany({
      where: (subs, { eq }) => eq(subs.status, "active"),
    });

    const dbSub = allSubs.find((s) => {
      const meta = s.metadata as any;
      return meta?.paypalSubscriptionId === paypalSubscriptionId;
    });

    if (!dbSub) {
      logger.warn(
        `No DB subscription found for PayPal subscription ${paypalSubscriptionId}`
      );
      return;
    }

    const now = new Date();
    const updates: any = {
      status: "active",
      updatedAt: now,
      metadata: {
        ...(dbSub.metadata as any || {}),
        lastSyncedAt: now.toISOString(),
        lastPayPalStatus: status,
      },
    };

    if (nextPeriodEnd) {
      updates.currentPeriodEnd = nextPeriodEnd;
    }

    await database
      .update(subscriptions)
      .set(updates)
      .where(eq(subscriptions.id, dbSub.id));

    if (nextPeriodEnd) {
      await database
        .update(organizations)
        .set({
          subscriptionStatus: "active",
          subscriptionEndDate: nextPeriodEnd,
          updatedAt: now,
        })
        .where(eq(organizations.id, dbSub.organizationId));
    }

    logger.info(
      `Synced subscription ${dbSub.id} from PayPal subscription ${paypalSubscriptionId}`
    );
  } catch (error: any) {
    logger.error(
      `Error syncing PayPal subscription ${paypalSubscriptionId}:`,
      error
    );
  }
}

async function markSubscriptionByPayPalId(
  paypalSubscriptionId: string,
  newStatus: "cancelled" | "past_due"
) {
  try {
    const allSubs = await database.query.subscriptions.findMany();

    const dbSub = allSubs.find((s) => {
      const meta = s.metadata as any;
      return meta?.paypalSubscriptionId === paypalSubscriptionId;
    });

    if (!dbSub) return;

    const now = new Date();
    await database
      .update(subscriptions)
      .set({
        status: newStatus,
        updatedAt: now,
        metadata: {
          ...(dbSub.metadata as any || {}),
          cancelledAt: now.toISOString(),
          cancelledViaPayPal: true,
        },
      })
      .where(eq(subscriptions.id, dbSub.id));

    await database
      .update(organizations)
      .set({ subscriptionStatus: newStatus, updatedAt: now })
      .where(eq(organizations.id, dbSub.organizationId));

    logger.info(
      `Marked subscription ${dbSub.id} as ${newStatus} via PayPal webhook`
    );
  } catch (error: any) {
    logger.error(
      `Error marking subscription for PayPal ID ${paypalSubscriptionId}:`,
      error
    );
  }
}
