import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";
import axios from "axios";
import { database } from "@/configs/connection.config";
import { subscriptions } from "@/schema/schema";
import { desc } from "drizzle-orm";

/**
 * Get PayPal access token for diagnostic purposes
 */
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
    logger.error("Error getting PayPal access token for diagnostic:", {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    throw error;
  }
};

/**
 * Get merchant account information from PayPal
 * Uses userinfo endpoint and database lookups to get merchant email
 */
const getPayPalMerchantInfo = async (accessToken: string) => {
  try {
    const baseURL =
      env.PAYPAL_MODE === "live"
        ? "https://api-m.paypal.com"
        : "https://api-m.sandbox.paypal.com";

    // Method 1: Try userinfo endpoint first (safest - no test orders needed)

    // Method 2: Try to get merchant info from Partner Referrals or Account Management API
    // This might work better than userinfo for client credentials
    try {
      // Try Partner Referrals API to get merchant info
      const partnerResponse = await axios
        .get(`${baseURL}/v1/customer/partners`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        })
        .catch(() => null); // Silently fail if endpoint doesn't exist

      if (partnerResponse?.data) {
        logger.info("Partner API response:", partnerResponse.data);
        // Extract merchant info if available
        const merchantEmail =
          partnerResponse.data?.email || partnerResponse.data?.merchant_email;
        if (merchantEmail && merchantEmail.includes("@")) {
          return {
            email: merchantEmail,
            name: null,
            verified: true,
          };
        }
      }
    } catch (partnerError: any) {
      logger.warn("Partner API not available:", {
        error: partnerError.message,
      });
    }

    // Method 3: Try userinfo endpoint (usually doesn't work with client credentials)
    try {
      const response = await axios.get(
        `${baseURL}/v1/identity/oauth2/userinfo`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      const data = response.data;

      // PayPal userinfo API returns data in different formats
      let email = null;
      let name = null;
      let verified = false;

      // Check for email in different possible locations
      if (
        data?.emails &&
        Array.isArray(data.emails) &&
        data.emails.length > 0
      ) {
        const verifiedEmail = data.emails.find((e: any) => e.verified === true);
        email = verifiedEmail?.value || data.emails[0]?.value || null;
        verified = verifiedEmail?.verified || false;
      } else if (
        data?.email &&
        typeof data.email === "string" &&
        data.email.includes("@")
      ) {
        email = data.email;
        verified = data.verified_account || data.verified || false;
      }

      // Extract name
      if (data?.name) {
        if (typeof data.name === "string") {
          name = data.name;
        } else if (data.name.given_name || data.name.family_name) {
          name = `${data.name.given_name || ""} ${
            data.name.family_name || ""
          }`.trim();
        }
      }

      // Only return if we got valid email
      if (email && email.includes("@") && !email.startsWith("http")) {
        return {
          email: email,
          name: name || null,
          verified: verified,
        };
      }
    } catch (userInfoError: any) {
      logger.warn("Userinfo endpoint not available with client credentials:", {
        error: userInfoError.message,
        status: userInfoError.response?.status,
      });
    }

    // Method 4: Try to get merchant email from recent payment captures in database
    // Check if we have any recent PayPal orders and try to get merchant info from PayPal
    try {
      const recentSubscriptions = await database.query.subscriptions.findMany({
        where: (subs, { and, isNotNull }) => and(isNotNull(subs.metadata)),
        orderBy: [desc(subscriptions.createdAt)],
        limit: 5,
      });

      for (const sub of recentSubscriptions) {
        const metadata = sub.metadata as any;
        const paypalOrderId =
          metadata?.paypalOrderId || metadata?.paypalCaptureId;

        if (paypalOrderId) {
          try {
            // Try to get order details from PayPal
            const orderDetailsResponse = await axios.get(
              `${baseURL}/v2/checkout/orders/${paypalOrderId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
              }
            );

            const payee = orderDetailsResponse.data?.purchase_units?.[0]?.payee;
            const merchantEmail = payee?.email_address;

            if (merchantEmail && merchantEmail.includes("@")) {
              logger.info("Got merchant email from recent order:", {
                email: merchantEmail,
                orderId: paypalOrderId,
              });

              return {
                email: merchantEmail,
                name: null,
                verified: true,
              };
            }
          } catch (orderError: any) {
            // Order might not exist or be accessible, continue to next
            continue;
          }
        }
      }
    } catch (dbError: any) {
      logger.warn("Could not check database for recent orders:", {
        error: dbError.message,
      });
    }

    // If all methods fail, return null
    logger.warn("All methods to get merchant email failed");
    return null;
  } catch (error: any) {
    logger.error("Error getting PayPal merchant info:", {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });
    return null;
  }
};

/**
 * Check PayPal configuration and return account information
 */
export const checkPayPalConfig = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const hasClientId = !!env.PAYPAL_CLIENT_ID;
    const hasClientSecret = !!env.PAYPAL_CLIENT_SECRET;
    const paypalMode = env.PAYPAL_MODE || "live";

    // Mask sensitive information
    const maskedClientId = env.PAYPAL_CLIENT_ID
      ? `${env.PAYPAL_CLIENT_ID.substring(
          0,
          8
        )}...${env.PAYPAL_CLIENT_ID.substring(env.PAYPAL_CLIENT_ID.length - 4)}`
      : "Not configured";

    let accountInfo = null;
    let isConnected = false;
    let errorMessage = null;

    // Try to connect and get account info
    if (hasClientId && hasClientSecret) {
      try {
        const accessToken = await getPayPalAccessToken();
        isConnected = true;

        // Try to get merchant account info
        try {
          accountInfo = await getPayPalMerchantInfo(accessToken);
        } catch (merchantError: any) {
          logger.warn("Could not fetch merchant info, but connection is valid");
        }
      } catch (connectError: any) {
        isConnected = false;
        errorMessage =
          connectError.response?.data?.error_description ||
          connectError.message ||
          "Failed to connect to PayPal";
        logger.error("PayPal connection failed:", {
          error: errorMessage,
          status: connectError.response?.status,
        });
      }
    }

    // Disable caching for this endpoint to ensure fresh data
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("ETag", `"${Date.now()}"`); // Unique ETag to prevent 304 responses

    res.status(200).json({
      success: true,
      data: {
        configured: hasClientId && hasClientSecret,
        mode: paypalMode,
        isLive: paypalMode === "live",
        isSandbox: paypalMode === "sandbox",
        clientId: maskedClientId,
        isConnected,
        accountInfo: accountInfo
          ? {
              email: accountInfo.email || "Not available",
              name: accountInfo.name || "Not available",
              verified: accountInfo.verified || false,
            }
          : null,
        error: errorMessage,
        instructions: {
          toUpdateAccount:
            "To change PayPal account, update PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in backend .env file with credentials from your new PayPal account",
          toUpdateFrontend:
            "Also update VITE_PAYPAL_CLIENT_ID in frontend .env file",
          restartRequired:
            "Restart both frontend and backend servers after updating",
        },
        timestamp: new Date().toISOString(), // Add timestamp to help with cache busting
      },
    });
  } catch (error: any) {
    logger.error("Error checking PayPal configuration:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check PayPal configuration",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
