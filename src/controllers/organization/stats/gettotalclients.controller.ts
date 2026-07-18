import { database } from "@/configs/connection.config";
import { clients } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq, and } from "drizzle-orm";
import status from "http-status";

export const getOrganizationTotalClients = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getOrganizationTotalClients called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get total count of clients for this organization
    const result = await database
      .select({
        totalClients: sql<number>`COUNT(*)`,
      })
      .from(clients)
      .where(and(eq(clients.organizationId, organizationId), eq(clients.clientType, "client")));

    const totalClients = result[0]?.totalClients || 0;

    logger.info(
      `✅ Total clients for organization ${organizationId}: ${totalClients}`
    );

    res.status(200).json({
      success: true,
      message: "Total clients fetched successfully",
      data: {
        totalClients,
      },
    });
  } catch (error) {
    logger.error("Error fetching total clients:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
