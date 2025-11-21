import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";
import axios from "axios";
import {
  organizations,
  userOrganizations,
  subscriptions,
  users,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
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
    // Validate credentials before making request
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      logger.error("PayPal credentials missing", {
        hasClientId: !!env.PAYPAL_CLIENT_ID,
        hasClientSecret: !!env.PAYPAL_CLIENT_SECRET,
      });
      throw new Error(
        "PayPal credentials not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your .env file."
      );
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
      logger.error("PayPal access token not received", {
        response: response.data,
        status: response.status,
      });
      throw new Error(
        "Failed to get PayPal access token: No token in response"
      );
    }

    return response.data.access_token;
  } catch (error: any) {
    logger.error("Error getting PayPal access token:", {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
      paypalMode: env.PAYPAL_MODE,
      hasClientId: !!env.PAYPAL_CLIENT_ID,
      hasClientSecret: !!env.PAYPAL_CLIENT_SECRET,
    });

    // Provide more specific error messages
    if (error.response?.status === 401) {
      throw new Error(
        "PayPal authentication failed. Please check your PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET credentials. Make sure you're using the correct credentials for sandbox or live mode."
      );
    }

    if (error.message.includes("credentials not configured")) {
      throw error; // Re-throw our custom error
    }

    throw new Error(
      `Failed to authenticate with PayPal: ${
        error.response?.data?.error_description || error.message
      }`
    );
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

    // Handle demo mode - skip all PayPal API calls
    if (orderId.startsWith("demo_order_")) {
      logger.info("Demo PayPal order captured:", orderId);
      paymentStatus = "COMPLETED";
      captureId = `demo_capture_${Date.now()}`;
      // Set default values for demo orders
      captureAmount = "0.00"; // Demo orders don't have real amounts
      captureCurrency = "USD";
      logger.info("Demo order processed, skipping PayPal API calls");
      // Skip to organization creation below
    } else {
      // Check if PayPal credentials are configured
      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
        logger.error("PayPal credentials not configured", {
          hasClientId: !!env.PAYPAL_CLIENT_ID,
          hasClientSecret: !!env.PAYPAL_CLIENT_SECRET,
          paypalMode: env.PAYPAL_MODE,
        });
        res.status(400).json({
          success: false,
          message:
            "PayPal is not configured on the server. Please configure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in your backend .env file.",
          code: "PAYPAL_NOT_CONFIGURED",
        });
        return;
      }

      try {
        // Get access token
        const accessToken = await getPayPalAccessToken();

        const baseURL =
          env.PAYPAL_MODE === "live"
            ? "https://api-m.paypal.com"
            : "https://api-m.sandbox.paypal.com";

        // First, check the order status before attempting to capture
        const orderDetailsResponse = await axios.get(
          `${baseURL}/v2/checkout/orders/${orderId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
          }
        );

        let orderStatus = orderDetailsResponse.data?.status;
        logger.info(
          `PayPal order status check: ${orderId}, status: ${orderStatus}`
        );

        // Check if order is already completed
        if (orderStatus === "COMPLETED") {
          logger.warn(
            `PayPal order ${orderId} is already completed. Retrieving existing capture details.`
          );

          // Get the existing capture details
          const existingCapture =
            orderDetailsResponse.data?.purchase_units?.[0]?.payments
              ?.captures?.[0];

          if (existingCapture) {
            paymentStatus = "COMPLETED";
            captureId = existingCapture.id || "";
            captureAmount = existingCapture.amount?.value || "";
            captureCurrency = existingCapture.amount?.currency_code || "USD";

            logger.info(
              `Using existing capture for order ${orderId}: ${captureId}`
            );
          } else {
            res.status(400).json({
              success: false,
              message:
                "Order is already completed but no capture details found.",
              code: "ORDER_ALREADY_COMPLETED",
            });
            return;
          }
        } else if (orderStatus !== "APPROVED") {
          // Order might still be in CREATED state if onApprove was called too quickly
          // Wait a bit and retry checking the order status
          if (orderStatus === "CREATED") {
            logger.info(
              `Order ${orderId} is still CREATED, waiting for approval status update...`
            );

            // Wait up to 3 seconds for order status to update to APPROVED
            let retryCount = 0;
            const maxRetries = 6; // 6 retries * 500ms = 3 seconds max
            let finalStatus = orderStatus;
            let shouldCapture = false;

            while (retryCount < maxRetries && finalStatus === "CREATED") {
              await new Promise((resolve) => setTimeout(resolve, 500)); // Wait 500ms

              try {
                const retryResponse = await axios.get(
                  `${baseURL}/v2/checkout/orders/${orderId}`,
                  {
                    headers: {
                      Authorization: `Bearer ${accessToken}`,
                      "Content-Type": "application/json",
                    },
                  }
                );
                finalStatus = retryResponse.data?.status;
                logger.info(
                  `Order ${orderId} status check (retry ${
                    retryCount + 1
                  }): ${finalStatus}`
                );

                // If status changed to APPROVED, we can proceed with capture
                if (finalStatus === "APPROVED") {
                  shouldCapture = true;
                  break;
                }

                // If status changed to COMPLETED, order was already captured
                if (finalStatus === "COMPLETED") {
                  const existingCapture =
                    retryResponse.data?.purchase_units?.[0]?.payments
                      ?.captures?.[0];

                  if (existingCapture) {
                    paymentStatus = "COMPLETED";
                    captureId = existingCapture.id || "";
                    captureAmount = existingCapture.amount?.value || "";
                    captureCurrency =
                      existingCapture.amount?.currency_code || "USD";
                    logger.info(
                      `Order ${orderId} was already completed during retry check.`
                    );
                    // Skip to organization creation - break out of while loop
                    break;
                  } else {
                    res.status(400).json({
                      success: false,
                      message:
                        "Order is already completed but no capture details found.",
                      code: "ORDER_ALREADY_COMPLETED",
                    });
                    return;
                  }
                }
              } catch (retryError) {
                logger.error(
                  `Error checking order status on retry: ${retryError}`
                );
                break;
              }

              retryCount++;
            }

            // If still CREATED after retries, return error
            if (finalStatus === "CREATED") {
              logger.error(
                `Order ${orderId} is still CREATED after ${maxRetries} retries. User may not have approved the order.`
              );
              res.status(400).json({
                success: false,
                message: `Order has not been approved yet. Please complete the PayPal approval process and try again.`,
                code: "ORDER_NOT_APPROVED",
                orderStatus: finalStatus,
              });
              return;
            }

            // If status changed to something other than APPROVED or COMPLETED, return error
            if (finalStatus !== "APPROVED" && finalStatus !== "COMPLETED") {
              logger.error(
                `Order ${orderId} has unexpected status after retry: ${finalStatus}`
              );
              res.status(400).json({
                success: false,
                message: `Cannot capture order. Order status is "${finalStatus}". Order must be approved before capture.`,
                code: "ORDER_NOT_APPROVED",
                orderStatus: finalStatus,
              });
              return;
            }

            // Update orderStatus to reflect the final status after retry
            orderStatus = finalStatus;

            // If order was already completed, skip capture and continue to organization creation
            if (finalStatus === "COMPLETED") {
              // Already set paymentStatus, captureId, etc. above
              // Continue to organization creation below
            } else if (shouldCapture && finalStatus === "APPROVED") {
              // Order is now APPROVED, proceed with capture below
              logger.info(
                `Order ${orderId} is now APPROVED after waiting, proceeding with capture.`
              );
              // Continue to capture logic below
            }
          } else {
            // Order is in some other state (not CREATED or APPROVED)
            logger.error(
              `Cannot capture PayPal order ${orderId}. Current status: ${orderStatus}. Order must be in APPROVED state.`
            );
            res.status(400).json({
              success: false,
              message: `Cannot capture order. Order status is "${orderStatus}". Order must be approved before capture.`,
              code: "ORDER_NOT_APPROVED",
              orderStatus,
            });
            return;
          }
        }

        // Only proceed with capture if order is APPROVED and not already completed
        // Note: orderStatus may have been updated during retry logic above
        if (paymentStatus !== "COMPLETED" && orderStatus === "APPROVED") {
          // Order is APPROVED, proceed with capture
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
            `PayPal order captured: ${orderId}, capture ID: ${captureId}, status: ${paymentStatus}`
          );
        }
      } catch (error: any) {
        logger.error("Error capturing PayPal order:", {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
          orderId,
          paypalMode: env.PAYPAL_MODE,
        });

        // Provide more specific error messages
        if (error.response?.status === 401) {
          res.status(401).json({
            success: false,
            message:
              "PayPal authentication failed. Please check your PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET credentials.",
            code: "PAYPAL_AUTH_FAILED",
          });
          return;
        }

        if (error.response?.status === 404) {
          res.status(404).json({
            success: false,
            message: `PayPal order not found: ${orderId}. The order may have expired or been cancelled.`,
            code: "PAYPAL_ORDER_NOT_FOUND",
          });
          return;
        }

        // Handle PayPal validation errors
        if (error.response?.data) {
          const paypalError = error.response.data;
          const errorName = paypalError.name || "";
          const errorMessage = paypalError.message || "";
          const errorDetails = paypalError.details || [];

          // Check for specific validation errors
          if (
            errorName === "UNPROCESSABLE_ENTITY" ||
            errorMessage.includes("semantically incorrect") ||
            errorMessage.includes("failed business validation")
          ) {
            // Extract more details from error
            const detailsMessage = errorDetails
              .map((detail: any) => detail?.description || detail?.issue || "")
              .filter(Boolean)
              .join("; ");

            logger.error("PayPal validation error:", {
              orderId,
              errorName,
              errorMessage,
              details: errorDetails,
            });

            res.status(422).json({
              success: false,
              message:
                detailsMessage ||
                errorMessage ||
                "PayPal order validation failed. The order may have already been captured, expired, or is in an invalid state.",
              code: "PAYPAL_VALIDATION_ERROR",
              details: {
                name: errorName,
                message: errorMessage,
                issues: errorDetails,
              },
            });
            return;
          }

          // Generic PayPal error
          res.status(error.response.status || 500).json({
            success: false,
            message:
              errorMessage || `PayPal error: ${errorName || "Unknown error"}`,
            code: "PAYPAL_ERROR",
            details: paypalError,
          });
          return;
        }

        // Generic error
        res.status(500).json({
          success: false,
          message:
            "Failed to capture PayPal order. Please try again or contact support.",
          code: "PAYPAL_CAPTURE_FAILED",
          error: error.message,
        });
        return;
      }
    }

    // Only create organization if payment was successful
    if (paymentStatus === "COMPLETED" && userId) {
      try {
        // Get user data including pending organization data
        const userData = await database.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, userId),
        });

        if (!userData) {
          logger.error(`User not found: ${userId}`);
          res.status(404).json({
            success: false,
            message: "User not found",
          });
          return;
        }

        // Get organization data from request or from user's pending data
        const pendingData = userData.pendingOrganizationData as {
          organizationName?: string;
          organizationWebsite?: string;
          organizationIndustry?: string;
          organizationSize?: string;
          planId?: string;
        } | null;

        const finalOrganizationName =
          organizationName || pendingData?.organizationName;
        const finalPlanId =
          planId || userData.selectedPlanId || pendingData?.planId;
        const finalOrganizationWebsite =
          organizationWebsite || pendingData?.organizationWebsite;
        const finalOrganizationIndustry =
          organizationIndustry || pendingData?.organizationIndustry;
        const finalOrganizationSize =
          organizationSize || pendingData?.organizationSize;

        if (!finalOrganizationName || !finalPlanId) {
          logger.error(
            `Missing organization name or plan ID for user: ${userId}`
          );
          res.status(400).json({
            success: false,
            message:
              "Missing organization name or plan ID. Please select a plan and provide organization details.",
          });
          return;
        }

        // At this point, finalPlanId is guaranteed to be a string
        const planIdString: string = finalPlanId;

        // Verify the plan exists and is active
        const plan = await database.query.subscriptionPlans.findFirst({
          where: (plans, { eq, and }) =>
            and(eq(plans.id, planIdString), eq(plans.isActive, true)),
        });

        if (!plan) {
          logger.error(`Plan not found: ${planIdString}`);
          res.status(404).json({
            success: false,
            message: "Selected plan not found or inactive",
          });
          return;
        }

        // Create organization slug from name
        const slug = finalOrganizationName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Check if organization already exists (pending payment) for this user
        let existingOrg = null;
        if (userId) {
          // Find organization by user's organization relationship
          const userOrg = await database.query.userOrganizations.findFirst({
            where: (userOrgs, { eq, and }) => and(eq(userOrgs.userId, userId)),
            with: {
              organization: true,
            },
          });

          if (userOrg?.organization) {
            existingOrg = userOrg.organization;
            // Also check by slug as fallback
            if (!existingOrg || existingOrg.slug !== slug) {
              existingOrg = await database.query.organizations.findFirst({
                where: (orgs, { eq }) => eq(orgs.slug, slug),
              });
            }
          } else {
            // Check by slug
            existingOrg = await database.query.organizations.findFirst({
              where: (orgs, { eq }) => eq(orgs.slug, slug),
            });
          }
        } else {
          // Check by slug only if no userId
          existingOrg = await database.query.organizations.findFirst({
            where: (orgs, { eq }) => eq(orgs.slug, slug),
          });
        }

        const now = new Date();
        let organizationId: string;
        let shouldUpdate = false;

        // If organization exists and is pending, update it; otherwise create new
        if (existingOrg && existingOrg.subscriptionStatus === "pending") {
          organizationId = existingOrg.id;
          shouldUpdate = true;
          logger.info(
            `Updating existing pending organization: ${organizationId} after payment`
          );
        } else if (
          existingOrg &&
          existingOrg.subscriptionStatus !== "pending"
        ) {
          // Organization exists but is not pending (already paid or active)
          logger.error(
            `Organization with slug already exists and is not pending: ${slug}`
          );
          res.status(409).json({
            success: false,
            message:
              "An organization with this name already exists and is active",
          });
          return;
        } else {
          // Create new organization
          organizationId = crypto.randomUUID().replace(/-/g, "");
          shouldUpdate = false;
          logger.info(
            `Creating new organization: ${organizationId} after payment`
          );
        }

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

        // Update or create organization
        let newOrganization;
        if (shouldUpdate) {
          // Update existing pending organization
          const updatedOrgs = await database
            .update(organizations)
            .set({
              name: finalOrganizationName,
              website: finalOrganizationWebsite,
              industry: finalOrganizationIndustry,
              size: finalOrganizationSize,
              subscriptionPlanId: planIdString,
              subscriptionStatus: "active",
              subscriptionStartDate: now,
              status: "active", // Set to active after successful payment
              trialEndsAt: trialEndsAt,
              maxUsers: plan.features?.maxUsers,
              maxProjects: plan.features?.maxProjects,
              maxStorage: plan.features?.maxStorage,
              updatedAt: now,
            })
            .where(eq(organizations.id, organizationId))
            .returning();
          newOrganization = updatedOrgs[0]!;
        } else {
          // Create new organization
          newOrganization = (
            await database
              .insert(organizations)
              .values({
                id: organizationId,
                name: finalOrganizationName,
                slug: slug,
                description: `${finalOrganizationName} organization`,
                website: finalOrganizationWebsite,
                industry: finalOrganizationIndustry,
                size: finalOrganizationSize,
                subscriptionPlanId: planIdString,
                subscriptionStatus: "active",
                subscriptionStartDate: now,
                status: "active", // Set to active after successful payment
                trialEndsAt: trialEndsAt,
                maxUsers: plan.features?.maxUsers,
                maxProjects: plan.features?.maxProjects,
                maxStorage: plan.features?.maxStorage,
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
              .returning()
          )[0];
        }

        // Create or update subscription record
        let newSubscription;
        if (shouldUpdate) {
          // Check if subscription already exists for this organization
          const existingSubscription =
            await database.query.subscriptions.findFirst({
              where: (subs, { eq, and }) =>
                and(
                  eq(subs.organizationId, organizationId),
                  eq(subs.planId, finalPlanId)
                ),
            });

          if (existingSubscription) {
            // Update existing subscription
            const updatedSubs = await database
              .update(subscriptions)
              .set({
                status: "active",
                currentPeriodStart: now,
                currentPeriodEnd: currentPeriodEnd,
                cancelAtPeriodEnd: false,
                trialStart: now,
                trialEnd: trialEndsAt,
                metadata: {
                  ...(existingSubscription.metadata as any),
                  paypalOrderId: orderId,
                  paypalCaptureId: captureId,
                  paymentCompletedAt: now.toISOString(),
                },
                updatedAt: now,
              })
              .where(eq(subscriptions.id, existingSubscription.id))
              .returning();
            newSubscription = updatedSubs[0];
          } else {
            // Create new subscription for existing organization
            const subscriptionId = crypto.randomUUID().replace(/-/g, "");
            newSubscription = (
              await database
                .insert(subscriptions)
                .values({
                  id: subscriptionId,
                  organizationId: organizationId,
                  planId: planIdString,
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
                .returning()
            )[0];
          }
        } else {
          // Create new subscription for new organization
          const subscriptionId = crypto.randomUUID().replace(/-/g, "");
          newSubscription = (
            await database
              .insert(subscriptions)
              .values({
                id: subscriptionId,
                organizationId: organizationId,
                planId: finalPlanId,
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
              .returning()
          )[0];
        }

        // Create or update user-organization relationship (user as owner)
        if (userId) {
          const existingUserOrg =
            await database.query.userOrganizations.findFirst({
              where: (userOrgs, { eq, and }) =>
                and(
                  eq(userOrgs.userId, userId),
                  eq(userOrgs.organizationId, organizationId)
                ),
            });

          if (!existingUserOrg) {
            // Create new user-organization relationship
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
          } else {
            // Update existing relationship to active
            await database
              .update(userOrganizations)
              .set({
                status: "active",
                updatedAt: now,
              })
              .where(eq(userOrganizations.id, existingUserOrg.id));
          }
        }

        logger.info(
          `Organization created after payment: ${organizationId} for user: ${userId} with subscription: ${newSubscription.id}`
        );

        // Activate user and clear pending data
        await database
          .update(users)
          .set({
            status: "active",
            selectedPlanId: null,
            pendingOrganizationData: null,
          })
          .where(eq(users.id, userId));

        // Get user info for notifications
        const userInfo = await database.query.users.findFirst({
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
            Owner: userInfo?.name || userInfo?.email || "Unknown",
            "Owner Email": userInfo?.email || "Unknown",
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
            User: userInfo?.name || userInfo?.email || "Unknown",
            "User Email": userInfo?.email || "Unknown",
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
            organization: newOrganization,
            subscription: newSubscription,
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
    logger.error("Error capturing PayPal order:", {
      error: error.message,
      stack: error.stack,
      response: error.response?.data,
      status: error.response?.status,
      orderId: req.body?.orderId,
    });

    // Check if it's a PayPal configuration error
    if (
      error.message?.includes("credentials not configured") ||
      error.message?.includes("PayPal is not configured")
    ) {
      res.status(400).json({
        success: false,
        message: error.message,
        code: "PAYPAL_NOT_CONFIGURED",
      });
      return;
    }

    // Check if it's a PayPal authentication error
    if (
      error.message?.includes("authentication failed") ||
      error.response?.status === 401
    ) {
      res.status(401).json({
        success: false,
        message: error.message || "PayPal authentication failed",
        code: "PAYPAL_AUTH_FAILED",
      });
      return;
    }

    // Provide detailed error in development, generic in production
    res.status(500).json({
      success: false,
      message: "Internal server error while capturing PayPal order",
      code: "PAYPAL_CAPTURE_ERROR",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error.message,
              response: error.response?.data,
              status: error.response?.status,
            }
          : undefined,
    });
    return;
  }
};
