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
      `Failed to authenticate with PayPal: ${error.response?.data?.error_description || error.message
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
    }: // demoMode = false, // COMMENTED OUT FOR PRODUCTION - Only real payments allowed
      CreatePayPalOrderRequest = req.body;

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

    // DEMO MODE COMMENTED OUT FOR PRODUCTION - Only real PayPal payments allowed
    // Check if PayPal credentials are configured (REQUIRED in production)
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      logger.error(
        "PayPal credentials not configured - Payment cannot be processed",
        {
          hasClientId: !!env.PAYPAL_CLIENT_ID,
          hasClientSecret: !!env.PAYPAL_CLIENT_SECRET,
        }
      );
      res.status(500).json({
        success: false,
        message: "Payment service is not configured. Please contact support.",
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

    // Log merchant account that will receive payment
    const merchantId =
      response.data.purchase_units?.[0]?.payee?.merchant_id || "Not available";
    const merchantEmail =
      response.data.purchase_units?.[0]?.payee?.email_address ||
      "Not available";

    logger.info(
      `PayPal order created: ${response.data.id} for plan: ${planId}, amount: ${amount} ${currency}`
    );
    logger.info(
      `💳 PAYMENT WILL GO TO - Merchant Account: ${merchantEmail} (ID: ${merchantId}), Mode: ${env.PAYPAL_MODE || "live"
      }`
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

    let paymentStatus = "PENDING"; // Initialize as PENDING, only set to COMPLETED after successful capture
    let captureId = "";
    let captureAmount = "";
    let captureCurrency = "USD";

    // DEMO MODE COMMENTED OUT FOR PRODUCTION - Only real PayPal payments allowed
    // Handle demo mode - skip all PayPal API calls
    // if (orderId.startsWith("demo_order_")) {
    //   logger.info("Demo PayPal order captured:", orderId);
    //   paymentStatus = "COMPLETED";
    //   captureId = `demo_capture_${Date.now()}`;
    //   // Set default values for demo orders
    //   captureAmount = "0.00"; // Demo orders don't have real amounts
    //   captureCurrency = "USD";
    //   logger.info("Demo order processed, skipping PayPal API calls");
    //   // Skip to organization creation below
    // } else {
    // Check if PayPal credentials are configured (REQUIRED in production)
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

      // Check if order has expired (PayPal orders expire after 3 hours if not captured)
      const orderCreateTime = orderDetailsResponse.data?.create_time;
      if (orderCreateTime) {
        const createDate = new Date(orderCreateTime);
        const now = new Date();
        const hoursSinceCreation =
          (now.getTime() - createDate.getTime()) / (1000 * 60 * 60);

        if (hoursSinceCreation > 3 && orderStatus !== "COMPLETED") {
          logger.warn(
            `PayPal order ${orderId} was created ${hoursSinceCreation.toFixed(
              2
            )} hours ago and may have expired. Status: ${orderStatus}`
          );
        }
      }

      // Check if order is already completed
      if (orderStatus === "COMPLETED") {
        logger.warn(
          `PayPal order ${orderId} is already completed. Retrieving existing capture details.`
        );

        // Get the existing capture details
        const existingCapture =
          orderDetailsResponse.data?.purchase_units?.[0]?.payments
            ?.captures?.[0];

        if (existingCapture && existingCapture.id) {
          paymentStatus = "COMPLETED";
          captureId = existingCapture.id;
          captureAmount = existingCapture.amount?.value || "";
          captureCurrency = existingCapture.amount?.currency_code || "USD";

          logger.info(
            `Using existing capture for order ${orderId}: ${captureId}`
          );
        } else {
          logger.error(
            `Order ${orderId} is marked as COMPLETED but no capture ID found. This should not happen.`
          );
          res.status(400).json({
            success: false,
            message:
              "Order is already completed but no capture details found. Please contact support.",
            code: "ORDER_ALREADY_COMPLETED_NO_CAPTURE",
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
                `Order ${orderId} status check (retry ${retryCount + 1
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

                if (existingCapture && existingCapture.id) {
                  paymentStatus = "COMPLETED";
                  captureId = existingCapture.id;
                  captureAmount = existingCapture.amount?.value || "";
                  captureCurrency =
                    existingCapture.amount?.currency_code || "USD";
                  logger.info(
                    `Order ${orderId} was already completed during retry check. Capture ID: ${captureId}`
                  );
                  // Skip to organization creation - break out of while loop
                  break;
                } else {
                  logger.error(
                    `Order ${orderId} is marked as COMPLETED but no capture ID found during retry.`
                  );
                  res.status(400).json({
                    success: false,
                    message:
                      "Order is already completed but no capture details found. Please contact support.",
                    code: "ORDER_ALREADY_COMPLETED_NO_CAPTURE",
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

        // Validate that capture was successful and has an ID
        if (!captureData || !captureData.id) {
          logger.error(
            `PayPal capture response missing capture ID for order ${orderId}`,
            {
              responseData: response.data,
              captureData,
            }
          );
          res.status(500).json({
            success: false,
            message:
              "PayPal capture completed but no capture ID was returned. Please contact support.",
            code: "PAYPAL_CAPTURE_NO_ID",
          });
          return;
        }

        paymentStatus = response.data.status;
        captureId = captureData.id;
        captureAmount = captureData.amount?.value || "";
        captureCurrency = captureData.amount?.currency_code || "USD";

        // Log merchant/receiver account information
        const merchantId =
          response.data.purchase_units?.[0]?.payee?.merchant_id ||
          "Not available";
        const merchantEmail =
          response.data.purchase_units?.[0]?.payee?.email_address ||
          "Not available";
        const payerEmail =
          response.data.payer?.email_address || "Not available";
        const payerName =
          response.data.payer?.name?.given_name +
          " " +
          response.data.payer?.name?.surname || "Not available";

        logger.info(
          `PayPal order captured: ${orderId}, capture ID: ${captureId}, status: ${paymentStatus}`
        );
        logger.info(
          `💰 PAYMENT RECEIVED - Merchant Account: ${merchantEmail} (ID: ${merchantId}), Payer: ${payerName} (${payerEmail}), Amount: ${captureAmount} ${captureCurrency}`
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
        logger.error(
          `PayPal order not found: ${orderId}. Order may have expired (PayPal orders expire after 3 hours) or been cancelled.`
        );
        res.status(404).json({
          success: false,
          message: `PayPal order not found: ${orderId}. The order may have expired (orders expire after 3 hours if not captured) or been cancelled. Please create a new order.`,
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
    // } // END OF COMMENTED DEMO MODE ELSE BLOCK

    // Only create organization if payment was successful AND capture ID exists
    // This ensures we never create a subscription without a valid PayPal capture
    if (paymentStatus === "COMPLETED" && captureId && userId) {
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

        // Check if user already has an organization
        const existingUserOrg =
          await database.query.userOrganizations.findFirst({
            where: (userOrgs, { eq }) => eq(userOrgs.userId, userId),
            with: {
              organization: true,
            },
          });

        // IMPORTANT FIX: If user already has an organization, use that one
        // regardless of whether organizationName is provided
        // This prevents payment from failing when user tries to create account through pricing page
        if (existingUserOrg?.organization) {
          logger.info(
            `User ${userId} already has organization ${existingUserOrg.organizationId}, creating subscription only`
          );

          if (!finalPlanId) {
            res.status(400).json({
              success: false,
              message: "Missing plan ID. Please select a plan.",
            });
            return;
          }

          // Verify the plan exists and is active
          const plan = await database.query.subscriptionPlans.findFirst({
            where: (plans, { eq, and }) =>
              and(eq(plans.id, finalPlanId), eq(plans.isActive, true)),
          });

          if (!plan) {
            logger.error(`Plan not found: ${finalPlanId}`);
            res.status(404).json({
              success: false,
              message: "Selected plan not found or inactive",
            });
            return;
          }

          // Create subscription for existing organization
          const existingOrg = existingUserOrg.organization;

          // Check if this is a demo organization - if yes, convert to regular client
          const orgSettings = existingOrg.settings as any;
          const isDemoOrg = orgSettings?.demo === true;

          // Check if subscription already exists
          const existingSubscription =
            await database.query.subscriptions.findFirst({
              where: (subs, { eq }) => eq(subs.organizationId, existingOrg.id),
            });

          const now = new Date();
          const subscriptionEndDate = new Date(
            now.getTime() + 30 * 24 * 60 * 60 * 1000
          ); // 30 days
          let subscriptionId: string;

          // If demo organization, prepare to remove demo flag
          let updatedSettings = orgSettings || {};
          if (isDemoOrg) {
            logger.info(
              `Converting demo organization ${existingOrg.id} to regular client after purchase`
            );
            // Remove demo-related settings
            updatedSettings = { ...updatedSettings };
            delete updatedSettings.demo;
            delete updatedSettings.demoCreatedAt;
            delete updatedSettings.demoCreatedBy;
            delete updatedSettings.demoRole;
            // Keep passwordChanged if exists (user might have changed password)
          }

          if (existingSubscription) {
            // Update existing subscription
            subscriptionId = existingSubscription.id;

            await database
              .update(subscriptions)
              .set({
                planId: finalPlanId,
                status: "active",
                currentPeriodStart: now,
                currentPeriodEnd: subscriptionEndDate,
                updatedAt: now,
              })
              .where(eq(subscriptions.id, subscriptionId));

            logger.info(
              `Updated subscription ${subscriptionId} for organization ${existingOrg.id}`
            );
          } else {
            // Create new subscription
            subscriptionId = crypto.randomUUID().replace(/-/g, "");

            await database.insert(subscriptions).values({
              id: subscriptionId,
              organizationId: existingOrg.id,
              planId: finalPlanId,
              status: "active",
              currentPeriodStart: now,
              currentPeriodEnd: subscriptionEndDate,
              createdAt: now,
              updatedAt: now,
            });

            logger.info(
              `Created subscription ${subscriptionId} for organization ${existingOrg.id}`
            );
          }

          // Update organization subscription status and main status
          // If it was a demo org, also remove demo flag from settings
          const updatedOrg = await database
            .update(organizations)
            .set({
              status: "active", // Set organization status to active after successful payment
              subscriptionStatus: "active",
              subscriptionPlanId: finalPlanId,
              subscriptionStartDate: now,
              subscriptionEndDate: subscriptionEndDate,
              settings: updatedSettings, // Remove demo flag if it was a demo org
              updatedAt: now,
            })
            .where(eq(organizations.id, existingOrg.id))
            .returning();

          logger.info(
            `✅ Organization ${existingOrg.id} updated after payment:`,
            {
              organizationId: existingOrg.id,
              status: updatedOrg[0]?.status,
              subscriptionStatus: updatedOrg[0]?.subscriptionStatus,
              isDemoOrg,
              userId,
            }
          );

          if (isDemoOrg) {
            logger.info(
              `✅ Demo organization ${existingOrg.id} converted to regular client after successful purchase`
            );
          }

          // Activate user and clear pending data (important for frontend status display)
          // Set isOrganizationOwner=true and role=user after successful purchase
          if (userId) {
            const updatedUser = await database
              .update(users)
              .set({
                status: "active",
                role: "user",
                isOrganizationOwner: true,
                selectedPlanId: null,
                pendingOrganizationData: null,
              })
              .where(eq(users.id, userId))
              .returning();

            logger.info(
              `✅ User ${userId} status updated to active after successful payment:`,
              {
                userId,
                userStatus: updatedUser[0]?.status,
                organizationId: existingOrg.id,
                organizationStatus: updatedOrg[0]?.status,
                organizationSubscriptionStatus:
                  updatedOrg[0]?.subscriptionStatus,
              }
            );
          }

          res.status(200).json({
            success: true,
            message:
              "Payment processed and subscription activated successfully",
            data: {
              orderId,
              status: paymentStatus,
              captureId,
              amount: captureAmount,
              currency: captureCurrency,
              organization: existingOrg,
              subscription: {
                id: subscriptionId,
                planId: finalPlanId,
                status: "active",
              },
            },
          });
          return;
        }

        // If organization name is required but not provided
        // Check if user has pending organization data or if we can use a default name
        if (!finalPlanId) {
          logger.error(`Missing plan ID for user: ${userId}`);
          res.status(400).json({
            success: false,
            message: "Missing plan ID. Please select a plan.",
          });
          return;
        }

        // If no organization name provided and user doesn't have existing org,
        // try to get from user's email or use a default
        let finalOrgName: string = finalOrganizationName || "";
        if (!finalOrgName && !existingUserOrg?.organization) {
          // Try to create organization name from user's email or use default
          const userEmail = userData.email;
          if (userEmail) {
            // Extract username from email (before @)
            const emailUsername = userEmail.split("@")[0];
            finalOrgName = `${emailUsername}'s Organization`;
            logger.info(
              `No organization name provided, using default: ${finalOrgName}`
            );
          } else {
            finalOrgName = "My Organization";
            logger.info(
              `No organization name provided, using default: ${finalOrgName}`
            );
          }
        }

        if (!finalOrgName || finalOrgName.trim() === "") {
          logger.error(
            `Missing organization name for user: ${userId} and no default could be generated`
          );
          res.status(400).json({
            success: false,
            message:
              "Missing organization name. Please provide organization details.",
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

        // Create organization slug from name (use finalOrgName which has fallback)
        // Include user ID in slug to allow multiple organizations with same name
        const baseSlug = finalOrgName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Make slug unique by appending user ID (allows multiple orgs with same name)
        let slug = userId
          ? `${baseSlug}-${userId.substring(0, 8)}`
          : `${baseSlug}-${Date.now()}`;

        // IMPORTANT: First check if user already has an organization
        // If user has an org, use that one regardless of the name provided
        // This prevents issues when user tries to create account through pricing page
        let userExistingOrg: {
          id: string;
          settings: any;
          subscriptionStatus: string | null;
          [key: string]: any;
        } | null = null;

        if (userId) {
          // Find organization by user's organization relationship
          const userOrg = await database.query.userOrganizations.findFirst({
            where: (userOrgs, { eq, and }) => and(eq(userOrgs.userId, userId)),
            with: {
              organization: true,
            },
          });

          if (userOrg?.organization) {
            // User already has an organization - use that one
            userExistingOrg = userOrg.organization;
            logger.info(
              `User ${userId} already has organization ${userExistingOrg.id}. Using existing organization instead of creating new one.`
            );
          }
        }

        const now = new Date();
        let organizationId: string;
        let shouldUpdate = false;

        // If user already has an organization, use that one
        if (userExistingOrg) {
          organizationId = userExistingOrg.id;
          // Check if it's pending or needs update
          if (userExistingOrg.subscriptionStatus === "pending") {
            shouldUpdate = true;
            logger.info(
              `Updating existing pending organization: ${organizationId} after payment`
            );
          } else {
            // User's org exists but is not pending - still update subscription
            shouldUpdate = true;
            logger.info(
              `User already has organization ${organizationId} (status: ${userExistingOrg.subscriptionStatus}). Updating subscription after payment.`
            );
          }
        } else {
          // User doesn't have an organization - check if pending org exists for this user
          // Since slug now includes user ID, we check by user's pending orgs instead
          if (userId) {
            // Check if user has a pending organization (by checking user-org relationships)
            const pendingUserOrg =
              await database.query.userOrganizations.findFirst({
                where: (userOrgs, { eq, and }) =>
                  and(
                    eq(userOrgs.userId, userId),
                    eq(userOrgs.status, "active")
                  ),
                with: {
                  organization: true,
                },
              });

            if (
              pendingUserOrg?.organization &&
              pendingUserOrg.organization.subscriptionStatus === "pending"
            ) {
              // User has a pending organization - update it
              organizationId = pendingUserOrg.organization.id;
              shouldUpdate = true;
              logger.info(
                `Updating existing pending organization: ${organizationId} after payment`
              );
            } else {
              // No pending org for this user - create new organization
              // Slug is already unique (includes user ID), so no conflict possible
              organizationId = crypto.randomUUID().replace(/-/g, "");
              shouldUpdate = false;
              logger.info(
                `Creating new organization: ${organizationId} with slug: ${slug} after payment`
              );
            }
          } else {
            // No userId - create new organization with timestamp-based unique slug
            organizationId = crypto.randomUUID().replace(/-/g, "");
            shouldUpdate = false;
            logger.info(
              `Creating new organization: ${organizationId} with slug: ${slug} after payment`
            );
          }
        }

        // Calculate trial end date based on plan's trialDays
        const planTrialDays = plan.trialDays ?? 7; // Use plan's trialDays or default to 7

        logger.info(`📊 Plan trialDays for plan ${planIdString}:`, {
          planId: planIdString,
          planName: plan.name,
          trialDays: plan.trialDays,
          planTrialDays: planTrialDays,
          planData: {
            id: plan.id,
            name: plan.name,
            trialDays: plan.trialDays,
            allFields: Object.keys(plan),
          },
        });

        const trialEndsAt =
          planTrialDays > 0
            ? new Date(now.getTime() + planTrialDays * 24 * 60 * 60 * 1000)
            : null; // If trialDays is 0, no trial period

        logger.info(`📅 Trial calculation:`, {
          planTrialDays,
          trialEndsAt: trialEndsAt?.toISOString(),
          now: now.toISOString(),
        });

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

        // If trial is active, set currentPeriodEnd to trialEnd, otherwise use subscription period
        const currentPeriodEnd =
          planTrialDays > 0 && trialEndsAt
            ? trialEndsAt // Trial period end
            : new Date(now.getTime() + subscriptionPeriodMs); // Regular subscription period end

        logger.info(`📅 Period calculation:`, {
          planTrialDays,
          hasTrial: planTrialDays > 0,
          trialEndsAt: trialEndsAt?.toISOString(),
          currentPeriodEnd: currentPeriodEnd.toISOString(),
          subscriptionPeriodMs,
        });

        // Check if existing organization is a demo org (for shouldUpdate case)
        // Get org settings from userExistingOrg or fetch from database if updating pending org
        let existingOrgSettings: any = null;
        if (shouldUpdate) {
          if (userExistingOrg) {
            existingOrgSettings = userExistingOrg.settings as any;
          } else {
            // If updating a pending org, fetch it to get settings
            const orgToUpdate = await database.query.organizations.findFirst({
              where: (orgs, { eq }) => eq(orgs.id, organizationId),
            });
            if (orgToUpdate) {
              existingOrgSettings = orgToUpdate.settings as any;
            }
          }
        }

        // If demo organization, prepare to remove demo flag
        let updatedSettingsForNewOrg = null;
        if (shouldUpdate && existingOrgSettings?.demo === true) {
          logger.info(
            `Converting demo organization ${organizationId} to regular client after purchase`
          );
          updatedSettingsForNewOrg = { ...existingOrgSettings };
          delete updatedSettingsForNewOrg.demo;
          delete updatedSettingsForNewOrg.demoCreatedAt;
          delete updatedSettingsForNewOrg.demoCreatedBy;
          delete updatedSettingsForNewOrg.demoRole;
        }

        // Update or create organization
        let newOrganization;
        if (shouldUpdate) {
          // Update existing organization (pending or user's existing org)
          const updateData: any = {
            // Only update name if it's a pending org, not if user already has an org
            // This prevents overwriting user's existing org name when they provide a conflicting name
            ...(userExistingOrg ? {} : { name: finalOrgName }),
            website: finalOrganizationWebsite,
            industry: finalOrganizationIndustry,
            size: finalOrganizationSize,
            subscriptionPlanId: planIdString,
            subscriptionStatus: "active",
            subscriptionStartDate: now,
            status: "active", // Set to active after successful payment
            trialEndsAt: planTrialDays > 0 ? trialEndsAt : null,
            maxUsers: plan.features?.maxUsers,
            maxProjects: plan.features?.maxProjects,
            maxStorage: plan.features?.maxStorage,
            updatedAt: now,
          };

          // Remove demo flag if it was a demo org
          if (updatedSettingsForNewOrg) {
            updateData.settings = updatedSettingsForNewOrg;
          }

          const updatedOrgs = await database
            .update(organizations)
            .set(updateData)
            .where(eq(organizations.id, organizationId))
            .returning();
          newOrganization = updatedOrgs[0]!;

          if (updatedSettingsForNewOrg) {
            logger.info(
              `✅ Demo organization ${organizationId} converted to regular client after successful purchase`
            );
          }
        } else {
          // Create new organization
          newOrganization = (
            await database
              .insert(organizations)
              .values({
                id: organizationId,
                name: finalOrgName,
                slug: slug,
                description: `${finalOrgName} organization`,
                website: finalOrganizationWebsite,
                industry: finalOrganizationIndustry,
                size: finalOrganizationSize,
                subscriptionPlanId: planIdString,
                subscriptionStatus: "active",
                subscriptionStartDate: now,
                status: "active", // Set to active after successful payment
                trialEndsAt: planTrialDays > 0 ? trialEndsAt : null,
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
                trialStart: planTrialDays > 0 ? now : null,
                trialEnd: planTrialDays > 0 ? trialEndsAt : null,
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
                  trialStart: planTrialDays > 0 ? now : null,
                  trialEnd: planTrialDays > 0 ? trialEndsAt : null,
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
                trialStart: planTrialDays > 0 ? now : null,
                trialEnd: planTrialDays > 0 ? trialEndsAt : null,
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
        // Set isOrganizationOwner=true and role=user after successful purchase
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
            orderId: orderId, // DEMO MODE REMOVED - Only real PayPal orders
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

    // Validate that we have a capture ID before returning success
    if (!captureId) {
      logger.error(
        `Payment processing completed but no capture ID for order ${orderId}`,
        {
          paymentStatus,
          orderId,
        }
      );
      res.status(500).json({
        success: false,
        message:
          "Payment processing completed but capture ID is missing. Please contact support.",
        code: "PAYPAL_CAPTURE_ID_MISSING",
      });
      return;
    }

    // If payment successful but no organization data provided, just return payment status
    res.status(200).json({
      success: true,
      message: "PayPal order captured successfully",
      data: {
        orderId: orderId,
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
