import { database } from "@/configs/connection.config";
import { invoices } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql } from "drizzle-orm";
import status from "http-status";

export const getTotalInvoices = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getTotalInvoices called for superadmin");

    // Get total count of all invoices across all organizations
    const result = await database
      .select({
        totalInvoices: sql<number>`COUNT(*)`,
      })
      .from(invoices);

    const totalInvoices = result[0]?.totalInvoices || 0;

    logger.info(`✅ Total invoices count: ${totalInvoices}`);

    res.status(200).json({
      success: true,
      message: "Total invoices fetched successfully",
      data: {
        totalInvoices,
      },
    });
  } catch (error) {
    logger.error("Error fetching total invoices:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
