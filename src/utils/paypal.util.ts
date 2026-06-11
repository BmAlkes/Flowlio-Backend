import axios from "axios";
import { env } from "./env.util";
import { logger } from "./logger.util";

export const getPayPalBaseURL = (): string =>
  env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

export const getPayPalAccessToken = async (): Promise<string> => {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error(
      "PayPal credentials not configured. Please set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
    );
  }

  const baseURL = getPayPalBaseURL();
  const auth = Buffer.from(
    `${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  try {
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
      throw new Error("Failed to get PayPal access token: No token in response");
    }

    return response.data.access_token;
  } catch (error: any) {
    logger.error("Error getting PayPal access token:", {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status,
    });

    if (error.response?.status === 401) {
      throw new Error(
        "PayPal authentication failed. Check PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET."
      );
    }

    throw new Error(
      `Failed to authenticate with PayPal: ${
        error.response?.data?.error_description || error.message
      }`
    );
  }
};
