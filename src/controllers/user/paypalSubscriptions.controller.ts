import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import { Request, Response } from "express";
import { database, connection } from "@/configs/connection.config";
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
import { eq, and, sql } from "drizzle-orm";
import { transaction, acceptSubscriptionEvent } from "@/services/subscription-reconciliation.service";
import { eventSubscriptionId, validDate } from "@/services/subscription-policy";
import crypto from "crypto";
import { getPayPalAccessToken, getPayPalBaseURL } from "@/utils/paypal.util";
import {
  ensureOrgAITokenLimit,
  DEFAULT_PAID_TOKEN_LIMIT,
} from "@/utils/aiTokenLimit.util";

// ── Billing plan setup ────────────────────────────────────────────────────────

function getBillingFrequency(plan: typeof subscriptionPlans.$inferSelect) {
  const type = String(plan.durationType || "monthly").toLowerCase().trim();
  const value = Number(plan.durationValue) || 1;

  if (type === "yearly" || type === "year") {
    return { interval_unit: "YEAR", interval_count: value };
  }
  if (type === "days" || type === "day") return { interval_unit: "DAY", interval_count: value };
  // Default: monthly billing
  return { interval_unit: "MONTH", interval_count: value };
}

async function ensurePayPalBillingPlan(
  inputPlan: typeof subscriptionPlans.$inferSelect
): Promise<string> {
  return database.transaction(async (database) => {
    await database.execute(sql`select id from subscription_plans where id=${inputPlan.id} for update`);
    const plan = await database.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.id, inputPlan.id) });
    if (!plan?.isActive) throw new Error("Plan no longer available");
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
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "PayPal-Request-Id": crypto.createHash("sha256").update("product:" + plan.id).digest("hex").slice(0, 38),
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
    const planName = plan.name ? `Flowlio – ${plan.name}` : "Flowlio Subscription";
    const billingRes = await axios.post(
      `${baseURL}/v1/billing/plans`,
      {
        product_id: productId,
        name: planName,
        description: plan.name || "Flowlio project management platform subscription",
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
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": crypto.createHash("sha256").update("plan:" + plan.id).digest("hex").slice(0, 38),
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
  });
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

    if (req.user?.organizationId) {
      if (req.user.userOrganization?.role !== "owner") {
        res.status(403).json({ success: false, message: "Only the organization owner can manage subscriptions" }); return;
      }
      const existing = await database.query.subscriptions.findFirst({ where: eq(subscriptions.organizationId, req.user.organizationId) });
      if (existing?.paypalSubscriptionId && !["CANCELLED", "EXPIRED"].includes((existing.metadata as any)?.paypalStatus)) {
        res.status(409).json({ success: false, message: "Cancel the existing recurring subscription before starting another" }); return;
      }
    }
    const paypalPlanId = await ensurePayPalBillingPlan(plan);

    // Fetch subscriber info to populate PayPal's "Payments from" fields
    const currentUser = await database.query.users.findFirst({
      where: (u, { eq }) => eq(u.id, req.user!.id),
      columns: { name: true, email: true },
    });

    // Split full name into given/surname for PayPal
    const nameParts = (currentUser?.name || "").trim().split(/\s+/);
    const givenName = nameParts[0] || currentUser?.email?.split("@")[0] || "User";
    const surname = nameParts.length > 1 ? nameParts.slice(1).join(" ") : givenName;

    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const subRes = await axios.post(
      `${baseURL}/v1/billing/subscriptions`,
      {
        plan_id: paypalPlanId,
        custom_id: req.user!.id,
        subscriber: {
          name: {
            given_name: givenName,
            surname,
          },
          email_address: currentUser?.email || req.user!.email,
        },
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
        timeout: 15000,
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
  country?: string;
  planId?: string;
}

export const activatePayPalSubscription = async (
  req: Request,
  res: Response
): Promise<void> => {
  const {
    subscriptionId,
    organizationName,
    organizationWebsite,
    organizationIndustry,
    organizationSize,
    country,
    planId: bodyPlanId,
  } = req.body as Omit<ActivateSubscriptionBody, "userId">;
  const userId = req.user?.id;

  if (!subscriptionId) {
    res.status(400).json({ success: false, message: "subscriptionId is required" });
    return;
  }

  try {
    // Verify subscription status with PayPal
    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const subDetails = await axios.get(
      `${baseURL}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
    );

    const paypalStatus: string = subDetails.data.status;
    const paypalPlanId: string = subDetails.data.plan_id;

    logger.info(
      `PayPal subscription ${subscriptionId} status: ${paypalStatus}, plan: ${paypalPlanId}`
    );

    if (paypalStatus !== "ACTIVE") {
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

    const activated = await database.transaction(async (database) => {
      await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`paypal-user:${userId}`}, 0))`);
      const linked = await database.query.subscriptions.findFirst({ where: eq(subscriptions.paypalSubscriptionId, subscriptionId) });
      const membership = linked && await database.query.userOrganizations.findFirst({ where: and(
        eq(userOrganizations.organizationId, linked.organizationId), eq(userOrganizations.userId, userId),
        eq(userOrganizations.role, "owner"), eq(userOrganizations.status, "active")) });
      if (linked) {
        if (!membership) { res.status(403).json({ success: false, message: "Subscription belongs to another account" }); return; }
        const linkedPlan = await database.query.subscriptionPlans.findFirst({ where: eq(subscriptionPlans.id, linked.planId) });
        return { orgId: linked.organizationId, dbSubscriptionId: linked.id, finalPlanId: linked.planId, plan: linkedPlan!, created: false };
      }
      if (subDetails.data.custom_id !== userId) {
        res.status(403).json({ success: false, message: "Subscription does not belong to this account. Please restart checkout." }); return;
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

      if (plan.paypalPlanId !== paypalPlanId) {
        res.status(400).json({ success: false, message: "PayPal plan does not match selected plan" }); return;
      }
      const now = new Date();
      const subscriptionEndDate = validDate(subDetails.data.billing_info?.next_billing_time);
      const paymentTime = validDate(subDetails.data.billing_info?.last_payment?.time);
      if (!subscriptionEndDate || subscriptionEndDate <= now || !paymentTime || paymentTime > now
          || Number(subDetails.data.billing_info?.failed_payments_count) > 0
          || Number(subDetails.data.billing_info?.outstanding_balance?.value) > 0) {
        res.status(409).json({ success: false, message: "Payment confirmation is pending. Please retry shortly." }); return;
      }
      const subscriptionMetadata = {
        paypalSubscriptionId: subscriptionId,
        paypalPlanId,
        activatedAt: now.toISOString(),
        paypalLastPaymentAt: paymentTime.toISOString(),
        paymentMethod: "PayPal Subscription",
      };

      // Check if user already has an org
      const existingUserOrg = await database.query.userOrganizations.findFirst({
        where: and(eq(userOrganizations.userId, userId), eq(userOrganizations.status, "active"),
          ...(req.user?.organizationId ? [eq(userOrganizations.organizationId, req.user.organizationId)] : [])),
        with: { organization: true },
      });

      let orgId: string;
      let dbSubscriptionId: string;

      if (existingUserOrg?.organization) {
        if (existingUserOrg.role !== "owner") {
          res.status(403).json({ success: false, message: "Only the organization owner can manage subscriptions" }); return;
        }
        await database.execute(sql`select id from organizations where id=${existingUserOrg.organization.id} for update`);
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

        if (existingSub?.paypalSubscriptionId && existingSub.paypalSubscriptionId !== subscriptionId
            && !["CANCELLED", "EXPIRED"].includes((existingSub.metadata as any)?.paypalStatus)) {
          res.status(409).json({ success: false, message: "Cancel the existing recurring subscription before replacing it" }); return;
        }
        if (existingSub) {
          dbSubscriptionId = existingSub.id;
          await database
            .update(subscriptions)
            .set({
              planId: finalPlanId,
              paypalSubscriptionId: subscriptionId,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: subscriptionEndDate,
              cancelAtPeriodEnd: false,
              updatedAt: now,
              metadata: { ...subscriptionMetadata },
            })
            .where(eq(subscriptions.id, dbSubscriptionId));
        } else {
          dbSubscriptionId = crypto.randomUUID().replace(/-/g, "");
          await database.insert(subscriptions).values({
            id: dbSubscriptionId,
            organizationId: orgId,
            planId: finalPlanId,
              paypalSubscriptionId: subscriptionId,
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
            ...(country && { country }),
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
          country: country || null,
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
              paypalSubscriptionId: subscriptionId,
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
      const configuredLimit = (plan.features as { aiTokenLimit?: number } | null)?.aiTokenLimit;
      const aiLimit = typeof configuredLimit === "number" && configuredLimit > 0 ? configuredLimit : DEFAULT_PAID_TOKEN_LIMIT;
      await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-quota:${orgId}`}, 0))`);
      await ensureOrgAITokenLimit(database, orgId, aiLimit);

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

      return { orgId, dbSubscriptionId, finalPlanId, plan, created: true };
    });
    if (!activated) return;
    const { orgId, dbSubscriptionId, finalPlanId, plan } = activated;
    if (activated.created) {
      void notifySuperAdmins({
        type: "userSubscribe", title: "New Subscription Activated",
        message: `PayPal subscription activated for organization ${orgId}.`,
        details: { "Organization ID": orgId, "Subscription ID": subscriptionId, "Plan Name": plan.name },
      }).catch(() => logger.error("Subscription activation notification failed"));
    }

    logger.info(
      `✅ PayPal subscription ${subscriptionId} activated for org ${orgId}, user ${userId}`
    );

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
      logger.error("PAYPAL_WEBHOOK_ID not configured — rejecting webhook");
      throw new Error("PayPal webhook verification is not configured");
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
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data?.verification_status === "SUCCESS";
  } catch (error: any) {
    logger.error("PayPal webhook verification unavailable");
    throw error;
  }
}

// ── POST /payments/paypal/webhook ─────────────────────────────────────────────

export const handlePayPalWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8")
      : typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const event = JSON.parse(rawBody);
    if (typeof event.id !== "string" || !event.id || typeof event.event_type !== "string") {
      res.status(400).json({ error: "Invalid event" }); return;
    }
    if (!(await verifyPayPalWebhookSignature(req, rawBody))) {
      res.status(401).json({ error: "Invalid webhook signature" }); return;
    }
    const providerId = eventSubscriptionId(event);
    await transaction(connection, client => acceptSubscriptionEvent(client, event.id, event.event_type, providerId));
    res.status(200).json({ received: true });
  } catch (error) {
    logger.error("PayPal webhook receipt failed", { error: error instanceof Error ? error.name : "Error" });
    res.status(503).json({ success: false, message: "Webhook receipt failed; retry required" });
  }
};
