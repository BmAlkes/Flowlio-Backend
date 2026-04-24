import { Response, Request } from "express";
import { recurringInvoices } from "@/schema/schema";
import { database } from "@/configs/connection.config";
import { desc } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import status from "http-status";
import { logger } from "@/utils/logger.util";

export const getRecurringTemplates = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const templates = await database.query.recurringInvoices.findMany({
      where: (recurringInvoices, { eq }) => eq(recurringInvoices.organizationId, organizationId),
      orderBy: [desc(recurringInvoices.createdAt)],
      with: {
        client: true,
      }
    });

    res.status(200).json({
      success: true,
      message: "Recurring templates fetched successfully",
      data: templates,
    });
  } catch (error) {
    logger.error("Error fetching recurring templates:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch recurring templates",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
