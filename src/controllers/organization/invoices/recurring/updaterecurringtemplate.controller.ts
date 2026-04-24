import { Response, Request } from "express";
import { recurringInvoices } from "@/schema/schema";
import { database } from "@/configs/connection.config";
import { updateRecurringInvoiceSchema } from "@/schema/validation";
import { eq, and } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import status from "http-status";
import { z } from "zod";
import { logger } from "@/utils/logger.util";

export const updateRecurringTemplate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const validatedData = updateRecurringInvoiceSchema.parse(req.body);

    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const updateData: any = { ...validatedData, updatedAt: new Date() };
    if (validatedData.startDate) updateData.startDate = new Date(validatedData.startDate);
    if (validatedData.endDate) updateData.endDate = new Date(validatedData.endDate);

    const [updatedTemplate] = await database
      .update(recurringInvoices)
      .set(updateData)
      .where(and(eq(recurringInvoices.id, id), eq(recurringInvoices.organizationId, organizationId)))
      .returning();

    if (!updatedTemplate) {
      res.status(404).json({ success: false, message: "Template not found" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Recurring template updated successfully",
      data: updatedTemplate,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: "Validation failed", errors: error.errors });
      return;
    }
    logger.error("Error updating recurring template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update recurring template",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
