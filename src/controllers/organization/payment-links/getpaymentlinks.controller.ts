import { Request, Response } from "express";
import { paymentLinks } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";

export interface GetPaymentLinksRequest {
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
  query: {
    clientId?: string;
    projectId?: string;
    status?: string;
  };
}

export const getPaymentLinks = async (
  req: GetPaymentLinksRequest & Request,
  res: Response
): Promise<void> => {
  try {
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

    const { clientId, projectId } = req.query;

    // Build query conditions
    const conditions = [
      eq(paymentLinks.organizationId, req.user!.organizationId),
    ];

    if (clientId) {
      conditions.push(eq(paymentLinks.clientId, clientId));
    }

    if (projectId) {
      conditions.push(eq(paymentLinks.projectId, projectId));
    }

    // Fetch payment links
    const paymentLinksData = await database
      .select()
      .from(paymentLinks)
      .where(and(...conditions))
      .orderBy(paymentLinks.createdAt);

    logger.info("Payment links fetched successfully:", {
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      count: paymentLinksData.length,
    });

    res.status(200).json({
      success: true,
      message: "Payment links fetched successfully",
      data: paymentLinksData,
    });
  } catch (error) {
    logger.error("Error fetching payment links:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch payment links",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
