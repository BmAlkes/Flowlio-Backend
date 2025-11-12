import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";
import axios from "axios";
import {
  organizations,
  userOrganizations,
  subscriptions,
} from "@/schema/schema";
import crypto from "crypto";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";

interface CreatePayPalOrderRequest {
  planId: string;
  amount: number;
  currency?: string;
}

interface CapturePayPalOrderRequest {
  orderId: string;
  userId?: string;
  organizationName?: string;
  organizationWebsite?: string;
  organizationIndustry?: string;
  organizationSize?: string;
  planId?: string;
}

// Get PayPal access token
const getPayPalAccessToken = async (): Promise<string> => {
  try {
    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    const auth = Buffer.from(
      `${env.PAYPAL_CLIENT_ID || ""}:${env.PAYPAL_CLIENT_SECRET || ""}`
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

    return response.data.access_token;
  } catch (error: any) {
    logger.error("Error getting PayPal access token:", error);
    throw new Error("Failed to authenticate with PayPal");
  }
};

// Create PayPal order
export const createPayPalOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      planId,
      amount,
      currency = "USD",
    }: CreatePayPalOrderRequest = req.body;

    // Validate required fields
    if (!planId || !amount) {
      res.status(400).json({
        success: false,
        message: "Missing required fields: planId, amount",
      });
      return;
    }

    // Verify the plan exists and is active
    const plan = await database.query.subscriptionPlans.findFirst({
      where: (plans, { eq, and }) =>
        and(eq(plans.id, planId), eq(plans.isActive, true)),
    });

    if (!plan) {
      res.status(404).json({
        success: false,
        message: "Selected plan not found or inactive",
      });
      return;
    }

    // Validate amount matches plan price
    const planPrice = parseFloat(plan.price.toString());
    if (amount !== planPrice) {
      res.status(400).json({
        success: false,
        message: "Payment amount does not match plan price",
      });
      return;
    }

    // Check if PayPal credentials are configured
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      logger.warn("PayPal credentials not configured, using demo mode");
      // Return demo order ID for testing
      res.status(200).json({
        success: true,
        message: "Demo PayPal order created",
        data: {
          orderId: `demo_order_${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`,
          status: "CREATED",
          amount,
          currency,
          plan: {
            id: plan.id,
            name: plan.name,
            price: plan.price,
            billingCycle: plan.billingCycle,
          },
        },
      });
      return;
    }

    // Get access token
    const accessToken = await getPayPalAccessToken();

    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Create PayPal order
    const orderData = {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: planId,
          description: `Subscription Plan: ${plan.name}`,
          amount: {
            currency_code: currency,
            value: amount.toString(),
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
      `PayPal order created: ${response.data.id} for plan: ${planId}, amount: ${amount} ${currency}`
    );

    res.status(200).json({
      success: true,
      message: "PayPal order created successfully",
      data: {
        orderId: response.data.id,
        status: response.data.status,
        amount,
        currency,
        plan: {
          id: plan.id,
          name: plan.name,
          price: plan.price,
          billingCycle: plan.billingCycle,
        },
      },
    });
    return;
  } catch (error: any) {
    logger.error("Error creating PayPal order:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while creating PayPal order",
      error:
        process.env.NODE_ENV === "development"
          ? error?.response?.data || error?.message
          : undefined,
    });
    return;
  }
};

// Capture PayPal order
export const capturePayPalOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      orderId,
      userId,
      organizationName,
      organizationWebsite,
      organizationIndustry,
      organizationSize,
      planId,
    }: CapturePayPalOrderRequest = req.body;

    // Validate required fields
    if (!orderId) {
      res.status(400).json({
        success: false,
        message: "Missing required field: orderId",
      });
      return;
    }

    let paymentStatus = "COMPLETED";
    let captureId = "";
    let captureAmount = "";
    let captureCurrency = "USD";

    // Handle demo mode
    if (orderId.startsWith("demo_order_")) {
      logger.info("Demo PayPal order captured:", orderId);
      paymentStatus = "COMPLETED";
      captureId = `demo_capture_${Date.now()}`;
    } else {
      // Check if PayPal credentials are configured
      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
        res.status(400).json({
          success: false,
          message: "PayPal is not configured. Please contact support.",
        });
        return;
      }

      // Get access token
      const accessToken = await getPayPalAccessToken();

      const baseURL =
        env.PAYPAL_MODE === "live"
          ? "https://api-m.paypal.com"
          : "https://api-m.sandbox.paypal.com";

      // Capture the order
      const response = await axios.post(
        `${baseURL}/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const captureData =
        response.data.purchase_units[0]?.payments?.captures?.[0];

      paymentStatus = response.data.status;
      captureId = captureData?.id || "";
      captureAmount = captureData?.amount?.value || "";
      captureCurrency = captureData?.amount?.currency_code || "USD";

      logger.info(
        `PayPal order captured: ${orderId}, capture ID: ${captureId}`
      );
    }

    // Only create organization if payment was successful and required data is provided
    if (paymentStatus === "COMPLETED" && userId && organizationName && planId) {
      try {
        // Verify the plan exists and is active
        const plan = await database.query.subscriptionPlans.findFirst({
          where: (plans, { eq, and }) =>
            and(eq(plans.id, planId), eq(plans.isActive, true)),
        });

        if (!plan) {
          logger.error(`Plan not found: ${planId}`);
          res.status(404).json({
            success: false,
            message: "Selected plan not found or inactive",
          });
          return;
        }

        // Create organization slug from name
        const slug = organizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Check if slug already exists
        const existingOrg = await database.query.organizations.findFirst({
          where: (orgs, { eq }) => eq(orgs.slug, slug),
        });

        if (existingOrg) {
          logger.error(`Organization with slug already exists: ${slug}`);
          res.status(409).json({
            success: false,
            message: "An organization with this name already exists",
          });
          return;
        }

        // Create organization
        const organizationId = crypto.randomUUID().replace(/-/g, "");
        const now = new Date();

        // Calculate trial end date (7 days from now)
        const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        // Calculate subscription period based on plan's durationValue and durationType
        let subscriptionPeriodMs = 30 * 24 * 60 * 60 * 1000; // Default: 30 days
        const durationValue = plan.durationValue ?? plan.durationValue;
        const durationType = plan.durationType ?? plan.durationType;

        if (durationValue && durationType) {
          const value = Number(durationValue);
          const type = String(durationType).toLowerCase().trim();

          if (!isNaN(value) && value > 0) {
            if (type === "days") {
              subscriptionPeriodMs = value * 24 * 60 * 60 * 1000;
            } else if (type === "monthly") {
              // Approximate: 30 days per month
              subscriptionPeriodMs = value * 30 * 24 * 60 * 60 * 1000;
            } else if (type === "yearly") {
              // Approximate: 365 days per year
              subscriptionPeriodMs = value * 365 * 24 * 60 * 60 * 1000;
            }
          }
        }

        const currentPeriodEnd = new Date(now.getTime() + subscriptionPeriodMs);

        const newOrganization = await database
          .insert(organizations)
          .values({
            id: organizationId,
            name: organizationName,
            slug: slug,
            description: `${organizationName} organization`,
            website: organizationWebsite,
            industry: organizationIndustry,
            size: organizationSize,
            subscriptionPlanId: planId,
            subscriptionStatus: "active",
            subscriptionStartDate: now,
            status: "active", // Set to active after successful payment
            trialEndsAt: trialEndsAt,
            maxUsers: plan.features?.maxUsers || 5,
            maxProjects: plan.features?.maxProjects || 3,
            maxStorage: plan.features?.maxStorage || 1,
            settings: {
              timezone: "UTC",
              dateFormat: "MM/DD/YYYY",
              currency: "USD",
              language: "en",
              notifications: {
                email: true,
                push: false,
                sms: false,
              },
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // Create subscription record
        const subscriptionId = crypto.randomUUID().replace(/-/g, "");
        const newSubscription = await database
          .insert(subscriptions)
          .values({
            id: subscriptionId,
            organizationId: organizationId,
            planId: planId,
            status: "active",
            currentPeriodStart: now,
            currentPeriodEnd: currentPeriodEnd,
            cancelAtPeriodEnd: false,
            trialStart: now,
            trialEnd: trialEndsAt,
            stripeSubscriptionId: null,
            stripeCustomerId: null,
            metadata: {
              createdBy: userId,
              organizationName: organizationName,
              paypalOrderId: orderId,
              paypalCaptureId: captureId,
            },
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // Create user-organization relationship (user as owner)
        const userOrgId = crypto.randomUUID().replace(/-/g, "");
        await database.insert(userOrganizations).values({
          id: userOrgId,
          userId: userId,
          organizationId: organizationId,
          role: "owner",
          status: "active",
          permissions: {
            canManageUsers: true,
            canManageProjects: true,
            canManageBilling: true,
            canViewAnalytics: true,
            canInviteUsers: true,
          },
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        logger.info(
          `Organization created after payment: ${organizationId} for user: ${userId} with subscription: ${subscriptionId}`
        );

        // Get user info for notifications
        const user = await database.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, userId),
          columns: {
            name: true,
            email: true,
          },
        });

        // Get plan info
        const planName = plan.name || "Unknown Plan";

        // Notify super admins about new company registration (non-blocking)
        notifySuperAdmins({
          type: "newCompany",
          title: "New Company Registration",
          message: `A new company "${organizationName}" has been registered on Flowlio.`,
          details: {
            "Company Name": organizationName,
            Owner: user?.name || user?.email || "Unknown",
            "Owner Email": user?.email || "Unknown",
            Plan: planName,
            "Registration Date": new Date().toLocaleString(),
          },
        }).catch((error) => {
          logger.error("Failed to send new company notification:", error);
        });

        // Notify super admins about user subscription (non-blocking)
        notifySuperAdmins({
          type: "userSubscribe",
          title: "User Subscription",
          message: `A user has subscribed to the "${planName}" plan.`,
          details: {
            User: user?.name || user?.email || "Unknown",
            "User Email": user?.email || "Unknown",
            Plan: planName,
            Company: organizationName,
            "Subscription Date": new Date().toLocaleString(),
          },
        }).catch((error) => {
          logger.error("Failed to send subscription notification:", error);
        });

        res.status(200).json({
          success: true,
          message:
            "PayPal payment captured and organization created successfully",
          data: {
            orderId: orderId.startsWith("demo_order_") ? orderId : orderId,
            status: paymentStatus,
            captureId: captureId,
            amount: captureAmount,
            currency: captureCurrency,
            organization: newOrganization[0],
            subscription: newSubscription[0],
            plan: plan,
          },
        });
        return;
      } catch (orgError: any) {
        logger.error("Error creating organization after payment:", orgError);
        // Payment was successful but organization creation failed
        res.status(500).json({
          success: false,
          message:
            "Payment was successful but organization creation failed. Please contact support.",
          error:
            process.env.NODE_ENV === "development"
              ? orgError?.message
              : undefined,
        });
        return;
      }
    }

    // If payment successful but no organization data provided, just return payment status
    res.status(200).json({
      success: true,
      message: "PayPal order captured successfully",
      data: {
        orderId: orderId.startsWith("demo_order_") ? orderId : orderId,
        status: paymentStatus,
        captureId: captureId,
        amount: captureAmount,
        currency: captureCurrency,
      },
    });
    return;
  } catch (error: any) {
    logger.error("Error capturing PayPal order:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while capturing PayPal order",
      error:
        process.env.NODE_ENV === "development"
          ? error?.response?.data || error?.message
          : undefined,
    });
    return;
  }
};
