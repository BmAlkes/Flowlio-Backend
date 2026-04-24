import { Response, Request } from "express";
import { recurringInvoices } from "@/schema/schema";
import { database } from "@/configs/connection.config";
import { createRecurringInvoiceSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";
import { z } from "zod";
import { logActivity } from "@/utils/activity.util";
import { requireOrganizationId } from "@/utils/organization.util";

interface CreateRecurringRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const createRecurringTemplate = async (
  req: CreateRecurringRequest,
  res: Response
): Promise<void> => {
  try {
    const validatedData = createRecurringInvoiceSchema.parse(req.body);

    if (!req.user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const client = await database.query.clients.findFirst({
      where: (clients, { eq, and }) =>
        and(eq(clients.id, validatedData.clientId), eq(clients.organizationId, organizationId)),
    });

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    const templateData = {
      id: randomUUID(),
      organizationId,
      clientId: validatedData.clientId,
      createdBy: req.user.id,
      templateName: validatedData.templateName,
      clientname: client.name,
      amount: validatedData.amount.toString(),
      description: validatedData.description || null,
      frequency: validatedData.frequency,
      startDate: new Date(validatedData.startDate),
      endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
      nextRunDate: new Date(validatedData.startDate),
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const [newTemplate] = await database
      .insert(recurringInvoices)
      .values(templateData as any)
      .returning();

    await logActivity({
      organizationId,
      actorId: req.user.id,
      type: "invoice",
      action: "create",
      resource: "recurring_invoice",
      resourceId: newTemplate.id,
      message: `Created recurring invoice template: ${validatedData.templateName} for ${client.name}`,
    });

    res.status(201).json({
      success: true,
      message: "Recurring invoice template created successfully",
      data: newTemplate,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: "Validation failed", errors: error.errors });
      return;
    }
    logger.error("Error creating recurring template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create recurring template",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
