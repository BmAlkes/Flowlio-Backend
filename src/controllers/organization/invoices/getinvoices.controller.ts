import { Request, Response } from "express";
import { invoices } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";

export interface GetInvoicesRequest {
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
  query: {
    clientId?: string;
    status?: string;
  };
}

export const getInvoices = async (
  req: GetInvoicesRequest & Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("Get invoices request received:", {
      user: req.user ? { id: req.user.id, email: req.user.email } : "No user",
      organizationId: req.user?.organizationId,
    });

    // Check if user is authenticated
    if (!req.user) {
      logger.warn("User not authenticated for get invoices");
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      logger.warn("User has no organization ID:", { userId: req.user.id });
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    const { clientId, status } = req.query;

    // Build query conditions
    const conditions = [
      eq(invoices.organizationId, req.user!.organizationId as string),
    ];

    if (clientId) {
      conditions.push(eq(invoices.clientId, clientId));
    }

    if (status) {
      conditions.push(eq(invoices.status, status));
    }

    // Fetch invoices
    const invoicesData = await database
      .select()
      .from(invoices)
      .where(and(...conditions))
      .orderBy(invoices.createdAt);

    logger.info("Invoices fetched successfully:", {
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
      count: invoicesData.length,
    });

    const responseData = {
      success: true,
      message: "Invoices fetched successfully",
      data: invoicesData,
    };

    logger.info("Sending response:", { 
      responseSize: JSON.stringify(responseData).length,
      invoiceCount: invoicesData.length 
    });

    res.status(200).json(responseData);
  } catch (error) {
    logger.error("Error fetching invoices:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch invoices",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
