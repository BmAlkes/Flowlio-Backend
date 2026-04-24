import { database } from "@/configs/connection.config";
import { invoices, clients } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import status from "http-status";

/**
 * Get all invoices for a specific client
 * Accepts organizationId in request body and clientId in params
 */
export const getInvoicesByClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { organizationId } = req.body; // Get organizationId from request body

    // Validate inputs
    if (!clientId) {
      logger.error("❌ Client ID is required");
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Client ID is required in params",
      });
      return;
    }

    // Validate organizationId from body
    if (!organizationId) {
      logger.error("❌ Organization ID is required in request body");
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required in request body",
      });
      return;
    }

    logger.info(
      `🔍 Fetching invoices for clientId: ${clientId}, organizationId: ${organizationId}`,
    );

    // Step 1: Verify that the clientId belongs to the specified organization
    const clientData = await database
      .select({
        id: clients.id,
        organizationId: clients.organizationId,
        name: clients.name,
      })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId),
        ),
      )
      .limit(1);

    // Verify client exists and belongs to the specified organization
    if (clientData.length === 0) {
      logger.warn(
        `⚠️ Client with ID ${clientId} not found in organization ${organizationId}`,
      );
      res.status(status.FORBIDDEN).json({
        success: false,
        message:
          "Client not found or does not belong to the specified organization",
      });
      return;
    }

    const clientInfo = clientData[0];
    logger.info(`✅ Client verified: ${clientInfo.name}`);

    // Step 2: Fetch all invoices for this client
    const invoicesData = await database
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.clientId, clientId),
          eq(invoices.organizationId, organizationId),
        ),
      )
      .orderBy(desc(invoices.createdAt));

    logger.info(
      `✅ Found ${invoicesData.length} invoices for client ${clientInfo.name}`,
    );

    res.status(status.OK).json({
      success: true,
      message: `Invoices fetched successfully for client: ${clientInfo.name}`,
      data: {
        clientId: clientId,
        clientName: clientInfo.name,
        invoiceCount: invoicesData.length,
        invoices: invoicesData,
      },
    });
  } catch (error) {
    logger.error("Error fetching invoices by client:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
