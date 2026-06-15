import { Request, Response } from "express";
import axios from "axios";
import { database } from "@/configs/connection.config";
import { aiTokenLimits } from "@/schema/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { getPayPalAccessToken, getPayPalBaseURL } from "@/utils/paypal.util";
import {
  TOKEN_PACKAGES,
  getTokenPackageById,
  insertDefaultAITokenLimit,
  DEFAULT_PAID_TOKEN_LIMIT,
} from "@/utils/aiTokenLimit.util";
import status from "http-status";

export const getTokenPackages = (_req: Request, res: Response): void => {
  res.json({ success: true, data: TOKEN_PACKAGES });
};

export const purchaseAITokens = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { packageId } = req.body as { packageId: string };
    const orgId = req.user?.organizationId;

    if (!orgId) {
      res
        .status(status.UNAUTHORIZED)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    const pkg = getTokenPackageById(packageId);
    if (!pkg) {
      res
        .status(status.BAD_REQUEST)
        .json({ success: false, message: "Invalid token package" });
      return;
    }

    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const response = await axios.post(
      `${baseURL}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            description: `Flowlio AI Tokens - ${pkg.label}`,
            custom_id: JSON.stringify({ orgId, packageId }),
            amount: {
              currency_code: pkg.currency,
              value: pkg.price,
            },
          },
        ],
        application_context: {
          brand_name: "Flowlio",
          user_action: "PAY_NOW",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const orderId = response.data.id as string;
    const approvalUrl = (
      response.data.links as Array<{ rel: string; href: string }>
    ).find((l) => l.rel === "approve")?.href;

    res.json({
      success: true,
      data: { orderId, approvalUrl, package: pkg },
    });
  } catch (err: any) {
    logger.error("purchaseAITokens error:", err);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create payment order",
    });
  }
};

export const confirmAITokenPurchase = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { orderId, packageId } = req.body as {
      orderId: string;
      packageId: string;
    };
    const orgId = req.user?.organizationId;

    if (!orgId || !orderId || !packageId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "orderId and packageId are required",
      });
      return;
    }

    const pkg = getTokenPackageById(packageId);
    if (!pkg) {
      res
        .status(status.BAD_REQUEST)
        .json({ success: false, message: "Invalid token package" });
      return;
    }

    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

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

    const captureStatus = captureResponse.data?.status as string | undefined;
    if (captureStatus !== "COMPLETED") {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: `Payment not completed. Status: ${captureStatus}`,
      });
      return;
    }

    // Ensure the org has a limit record before incrementing
    await insertDefaultAITokenLimit(orgId, DEFAULT_PAID_TOKEN_LIMIT);

    const now = new Date();
    const updated = await database
      .update(aiTokenLimits)
      .set({
        tokenLimit: sql`${aiTokenLimits.tokenLimit} + ${pkg.tokens}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature),
          eq(aiTokenLimits.isActive, true)
        )
      )
      .returning({ newLimit: aiTokenLimits.tokenLimit });

    const newTokenLimit = updated[0]?.newLimit ?? pkg.tokens;

    logger.info(
      `AI token top-up: org ${orgId} +${pkg.tokens} tokens → limit now ${newTokenLimit}`
    );

    res.json({
      success: true,
      message: `${pkg.label} added successfully`,
      data: {
        tokensAdded: pkg.tokens,
        newTokenLimit,
      },
    });
  } catch (err: any) {
    logger.error("confirmAITokenPurchase error:", err);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to confirm token purchase",
    });
  }
};
