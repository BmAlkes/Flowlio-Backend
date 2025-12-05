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
import { env } from "@/utils/env.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import axios from "axios";

interface CreateUpgradeOrderRequest {
  newPlanId: string;
  demoMode?: boolean;
}

// Get PayPal access token (reuse from payment controller)
const getPayPalAccessToken = async (): Promise<string> => {
  try {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new Error("PayPal credentials not configured");
    }

    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const auth = Buffer.from(
      `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await axios.post(
      `${baseURL}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    if (!response.data?.access_token) {
      throw new Error("Failed to get PayPal access token");
    }

    return response.data.access_token;
  } catch (error: any) {
    logger.error("Error getting PayPal access token:", error);
    throw error;
  }
};

// Calculate prorated amount for plan upgrade
const calculateProratedAmount = (
  currentPlanPrice: number,
  newPlanPrice: number,
  currentPeriodStart: Date,
  currentPeriodEnd: Date
): number => {
  const now = new Date();
  const totalPeriodDays =
    (currentPeriodEnd.getTime() - currentPeriodStart.getTime()) /
    (1000 * 60 * 60 * 24);
  const remainingDays =
    (currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

  if (remainingDays <= 0) {
    // Period has ended, charge full new plan price
    return newPlanPrice;
  }

  // Calculate daily rates
  const currentDailyRate = currentPlanPrice / totalPeriodDays;
  const newDailyRate = newPlanPrice / totalPeriodDays;

  // Calculate unused credit from current plan
  const unusedCredit = currentDailyRate * remainingDays;

  // Calculate cost for remaining days at new plan rate
  const newPlanCost = newDailyRate * remainingDays;

  // Prorated amount = new plan cost - unused credit
  const proratedAmount = newPlanCost - unusedCredit;

  // If downgrading, return 0 (no charge, but also no refund)
  // If upgrading, return the difference
  return Math.max(0, proratedAmount);
};

// Create PayPal order for plan upgrade
export const createUpgradeOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { newPlanId, demoMode = false }: CreateUpgradeOrderRequest = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!newPlanId) {
      res.status(400).json({
        success: false,
        message: "New plan ID is required",
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

    // Get current active subscription
    const currentSubscription = await database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active")
        )
      )
      .limit(1);

    if (!currentSubscription.length) {
      res.status(404).json({
        success: false,
        message: "No active subscription found",
      });
      return;
    }

    const subscription = currentSubscription[0];
    const now = new Date();

    // Check if subscription period has ended
    if (subscription.currentPeriodEnd < now) {
      res.status(400).json({
        success: false,
        message:
          "Subscription period has ended. Please renew your subscription first.",
      });
      return;
    }

    // Get current plan
    const currentPlan = await database
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, subscription.planId))
      .limit(1);

    if (!currentPlan.length) {
      res.status(404).json({
        success: false,
        message: "Current plan not found",
      });
      return;
    }

    // Get new plan
    const newPlan = await database
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, newPlanId))
      .limit(1);

    if (!newPlan.length) {
      res.status(404).json({
        success: false,
        message: "New plan not found",
      });
      return;
    }

    // Check if user is trying to upgrade to the same plan
    if (subscription.planId === newPlanId) {
      res.status(400).json({
        success: false,
        message: "You are already on this plan",
      });
      return;
    }

    const currentPlanPrice = parseFloat(currentPlan[0].price.toString());
    const newPlanPrice = parseFloat(newPlan[0].price.toString());

    // Calculate prorated amount
    const proratedAmount = calculateProratedAmount(
      currentPlanPrice,
      newPlanPrice,
      subscription.currentPeriodStart,
      subscription.currentPeriodEnd
    );

    logger.info("Plan upgrade calculation:", {
      currentPlan: currentPlan[0].name,
      currentPrice: currentPlanPrice,
      newPlan: newPlan[0].name,
      newPrice: newPlanPrice,
      proratedAmount,
      remainingDays:
        (subscription.currentPeriodEnd.getTime() - now.getTime()) /
        (1000 * 60 * 60 * 24),
    });

    // If prorated amount is 0 or negative (downgrade), allow free upgrade
    // but still create an order for tracking purposes
    const finalAmount = Math.max(0, proratedAmount);
    const currency = (newPlan[0].currency as string) || "USD";

    // Check if demo mode is requested or PayPal credentials are not configured
    if (demoMode || !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      logger.warn("Using demo mode for upgrade order", {
        demoMode,
        hasCredentials: !!env.PAYPAL_CLIENT_ID,
      });

      res.status(200).json({
        success: true,
        message: "Demo upgrade order created",
        data: {
          orderId: `demo_upgrade_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          status: "CREATED",
          amount: finalAmount,
          currency,
          currentPlan: {
            id: currentPlan[0].id,
            name: currentPlan[0].name,
            price: currentPlanPrice,
          },
          newPlan: {
            id: newPlan[0].id,
            name: newPlan[0].name,
            price: newPlanPrice,
          },
          proratedAmount: finalAmount,
          isUpgrade: newPlanPrice > currentPlanPrice,
          isDowngrade: newPlanPrice < currentPlanPrice,
        },
      });
      return;
    }

    // If amount is 0 (downgrade or same price), return success without PayPal
    if (finalAmount === 0) {
      logger.info(
        `Free plan change from ${currentPlan[0].name} to ${newPlan[0].name}`
      );

      // Update subscription immediately for free changes
      await database
        .update(subscriptions)
        .set({
          planId: newPlanId,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, subscription.id));

      // Update organization
      await database
        .update(organizations)
        .set({
          subscriptionPlanId: newPlanId,
          updatedAt: now,
        })
        .where(eq(organizations.id, organizationId));

      res.status(200).json({
        success: true,
        message: "Plan updated successfully (no payment required)",
        data: {
          orderId: null,
          status: "COMPLETED",
          amount: 0,
          currency,
          currentPlan: {
            id: currentPlan[0].id,
            name: currentPlan[0].name,
            price: currentPlanPrice,
          },
          newPlan: {
            id: newPlan[0].id,
            name: newPlan[0].name,
            price: newPlanPrice,
          },
          proratedAmount: 0,
          isUpgrade: newPlanPrice > currentPlanPrice,
          isDowngrade: newPlanPrice < currentPlanPrice,
        },
      });
      return;
    }

    // Get PayPal access token
    const accessToken = await getPayPalAccessToken();

    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Create PayPal order for prorated amount
    const orderData = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `upgrade_${subscription.id}_${newPlanId}`,
          description: `Plan Upgrade: ${currentPlan[0].name} → ${newPlan[0].name} (Prorated)`,
          amount: {
            currency_code: currency,
            value: finalAmount.toFixed(2),
          },
        },
      ],
    };

    const response = await axios.post(
      `${baseURL}/v2/checkout/orders`,
      orderData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    logger.info(
      `PayPal upgrade order created: ${response.data.id} for plan upgrade: ${currentPlan[0].name} → ${newPlan[0].name}, prorated amount: ${finalAmount} ${currency}`
    );

    res.status(200).json({
      success: true,
      message: "Upgrade order created successfully",
      data: {
        orderId: response.data.id,
        status: response.data.status,
        amount: finalAmount,
        currency,
        currentPlan: {
          id: currentPlan[0].id,
          name: currentPlan[0].name,
          price: currentPlanPrice,
        },
        newPlan: {
          id: newPlan[0].id,
          name: newPlan[0].name,
          price: newPlanPrice,
        },
        proratedAmount: finalAmount,
        isUpgrade: newPlanPrice > currentPlanPrice,
        isDowngrade: newPlanPrice < currentPlanPrice,
      },
    });
    return;
  } catch (error: any) {
    logger.error("Error creating upgrade order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create upgrade order",
      error:
        process.env.NODE_ENV === "development"
          ? error?.response?.data || error?.message
          : undefined,
    });
    return;
  }
};

// Capture upgrade order and update subscription
export const captureUpgradeOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { orderId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!orderId) {
      res.status(400).json({
        success: false,
        message: "Order ID is required",
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

    // Handle demo mode
    if (orderId.startsWith("demo_upgrade_")) {
      logger.info("Demo upgrade order captured:", orderId);

      // For demo, we need to get the new plan ID from somewhere
      // In a real scenario, you'd store this in a session or pass it in the request
      const { newPlanId } = req.body;

      if (!newPlanId) {
        res.status(400).json({
          success: false,
          message: "New plan ID is required for demo upgrade",
        });
        return;
      }

      // Get current subscription
      const currentSubscription = await database
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.organizationId, organizationId),
            eq(subscriptions.status, "active")
          )
        )
        .limit(1);

      if (!currentSubscription.length) {
        res.status(404).json({
          success: false,
          message: "No active subscription found",
        });
        return;
      }

      const subscription = currentSubscription[0];
      const now = new Date();

      // Update subscription with new plan
      await database
        .update(subscriptions)
        .set({
          planId: newPlanId,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, subscription.id));

      // Update organization
      await database
        .update(organizations)
        .set({
          subscriptionPlanId: newPlanId,
          updatedAt: now,
        })
        .where(eq(organizations.id, organizationId));

      logger.info(
        `Demo upgrade completed: Organization ${organizationId} upgraded to plan ${newPlanId}`
      );

      // Get organization, user, and plan details for notification
      const org = userOrg[0].organization;
      const oldPlan = await database.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.id, subscription.planId),
        columns: { name: true, price: true },
      });
      const newPlan = await database.query.subscriptionPlans.findFirst({
        where: eq(subscriptionPlans.id, newPlanId),
        columns: { name: true, price: true },
      });
      const user = await database.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { name: true, email: true },
      });

      // Notify super admins about plan upgrade
      await notifySuperAdmins({
        type: "planUpgrade",
        title: "Plan Upgraded",
        message: `A user has upgraded their subscription plan.`,
        details: {
          "Organization Name": org.name || "N/A",
          "Organization ID": organizationId,
          "User Name": user?.name || "N/A",
          "User Email": user?.email || "N/A",
          "Old Plan": oldPlan?.name || "N/A",
          "Old Plan Price": oldPlan?.price ? `$${oldPlan.price}` : "N/A",
          "New Plan": newPlan?.name || "N/A",
          "New Plan Price": newPlan?.price ? `$${newPlan.price}` : "N/A",
          "Subscription ID": subscription.id,
          "Upgrade Type": "Demo",
        },
      });

      res.status(200).json({
        success: true,
        message: "Plan upgraded successfully (demo)",
        data: {
          orderId,
          subscriptionId: subscription.id,
          newPlanId,
        },
      });
      return;
    }

    // Real PayPal order capture
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      res.status(500).json({
        success: false,
        message: "PayPal is not configured",
        code: "PAYPAL_NOT_CONFIGURED",
      });
      return;
    }

    const accessToken = await getPayPalAccessToken();
    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Get order details to extract new plan ID from reference_id
    const orderResponse = await axios.get(
      `${baseURL}/v2/checkout/orders/${orderId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const orderStatus = orderResponse.data.status;
    const referenceId = orderResponse.data.purchase_units?.[0]?.reference_id;

    if (!referenceId || !referenceId.startsWith("upgrade_")) {
      res.status(400).json({
        success: false,
        message: "Invalid upgrade order",
      });
      return;
    }

    // Extract new plan ID from reference_id (format: upgrade_{subscriptionId}_{newPlanId})
    const parts = referenceId.split("_");
    if (parts.length < 3) {
      res.status(400).json({
        success: false,
        message: "Invalid upgrade order reference",
      });
      return;
    }

    const newPlanId = parts.slice(2).join("_"); // Handle UUIDs with underscores

    // Check order status
    if (orderStatus === "COMPLETED") {
      // Order already completed, just update subscription
      logger.info(`Upgrade order ${orderId} already completed`);
    } else if (orderStatus === "APPROVED") {
      // Capture the order
      const captureResponse = await axios.post(
        `${baseURL}/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const captureStatus = captureResponse.data.status;
      if (captureStatus !== "COMPLETED") {
        res.status(400).json({
          success: false,
          message: `Order capture failed. Status: ${captureStatus}`,
        });
        return;
      }
    } else {
      res.status(400).json({
        success: false,
        message: `Order not approved. Current status: ${orderStatus}`,
      });
      return;
    }

    // Get current subscription
    const currentSubscription = await database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active")
        )
      )
      .limit(1);

    if (!currentSubscription.length) {
      res.status(404).json({
        success: false,
        message: "No active subscription found",
      });
      return;
    }

    const subscription = currentSubscription[0];
    const now = new Date();

    // Update subscription with new plan (keep same period end date)
    await database
      .update(subscriptions)
      .set({
        planId: newPlanId,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subscription.id));

    // Update organization
    await database
      .update(organizations)
      .set({
        subscriptionPlanId: newPlanId,
        updatedAt: now,
      })
      .where(eq(organizations.id, organizationId));

    logger.info(
      `Upgrade completed: Organization ${organizationId} upgraded to plan ${newPlanId}, order: ${orderId}`
    );

    // Get organization, user, and plan details for notification
    const org = userOrg[0].organization;
    const oldPlan = await database.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, subscription.planId),
      columns: { name: true, price: true },
    });
    const newPlan = await database.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, newPlanId),
      columns: { name: true, price: true },
    });
    const user = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { name: true, email: true },
    });

    // Get payment amount from PayPal order
    let paymentAmount = "N/A";
    try {
      const orderDetails = orderResponse?.data;
      if (orderDetails?.purchase_units?.[0]?.amount?.value) {
        paymentAmount = `$${orderDetails.purchase_units[0].amount.value} ${
          orderDetails.purchase_units[0].amount.currency_code || "USD"
        }`;
      }
    } catch (error) {
      logger.warn("Could not extract payment amount from PayPal order");
    }

    // Notify super admins about plan upgrade
    await notifySuperAdmins({
      type: "planUpgrade",
      title: "Plan Upgraded",
      message: `A user has upgraded their subscription plan.`,
      details: {
        "Organization Name": org.name || "N/A",
        "Organization ID": organizationId,
        "User Name": user?.name || "N/A",
        "User Email": user?.email || "N/A",
        "Old Plan": oldPlan?.name || "N/A",
        "Old Plan Price": oldPlan?.price ? `$${oldPlan.price}` : "N/A",
        "New Plan": newPlan?.name || "N/A",
        "New Plan Price": newPlan?.price ? `$${newPlan.price}` : "N/A",
        "Payment Amount": paymentAmount,
        "Subscription ID": subscription.id,
        "PayPal Order ID": orderId,
        "Upgrade Type": "Real Payment",
      },
    });

    res.status(200).json({
      success: true,
      message: "Plan upgraded successfully",
      data: {
        orderId,
        subscriptionId: subscription.id,
        newPlanId,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });
    return;
  } catch (error: any) {
    logger.error("Error capturing upgrade order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to capture upgrade order",
      error:
        process.env.NODE_ENV === "development"
          ? error?.response?.data || error?.message
          : undefined,
    });
    return;
  }
};
