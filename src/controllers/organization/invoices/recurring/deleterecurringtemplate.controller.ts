import { Response, Request } from "express";
import { recurringInvoices } from "@/schema/schema";
import { database } from "@/configs/connection.config";
import { eq, and } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import status from "http-status";
import { logger } from "@/utils/logger.util";

export const deleteRecurringTemplate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const [deletedTemplate] = await database
      .delete(recurringInvoices)
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, organizationId)))
      .returning();

    if (!deletedTemplate) {
      res.status(404).json({ success: false, message: "Template not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Recurring template deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting recurring template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete recurring template",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
