import { Request, Response } from "express";
import { paymentLinks } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";

export interface DeletePaymentLinkRequest {
  params: {
    id: string;
  };
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const deletePaymentLink = async (
  req: DeletePaymentLinkRequest & Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }
    const organizationId = req.user!.organizationId as string;

    // Check if payment link exists and belongs to the organization
    const existingPaymentLink = await database
      .select()
      .from(paymentLinks)
      .where(
        and(
          eq(paymentLinks.id, id),
          eq(paymentLinks.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingPaymentLink.length === 0) {
      res.status(404).json({
        success: false,
        message: "Payment link not found",
      });
      return;
    }

    // Delete the payment link
    await database
      .delete(paymentLinks)
      .where(
        and(
          eq(paymentLinks.id, id),
          eq(paymentLinks.organizationId, organizationId)
        )
      );

    logger.info("Payment link deleted successfully:", {
      paymentLinkId: id,
      userId: req.user.id,
      organizationId: organizationId,
    });

    res.status(200).json({
      success: true,
      message: "Payment link deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting payment link:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete payment link",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
