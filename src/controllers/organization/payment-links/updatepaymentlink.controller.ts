import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { paymentLinks, clients, projects } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { z } from "zod";

const updatePaymentLinkBodySchema = z.object({
  clientId: z.string().min(1, "Client is required").optional(),
  projectId: z.string().min(1, "Project is required").optional(),
  description: z.string().min(1, "Description is required").optional(),
  amount: z.number().min(0.01, "Amount must be greater than 0").optional(),
  externalPaymentUrl: z.string().url("Must be a valid URL").optional(),
});

export const updatePaymentLink = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const { id } = req.params;
    const organizationId = req.user.organizationId as string;

    const bodyResult = updatePaymentLinkBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: bodyResult.error.errors,
      });
      return;
    }

    const body = bodyResult.data;
    if (Object.keys(body).length === 0) {
      res.status(400).json({ success: false, message: "No fields to update" });
      return;
    }

    // Verify the payment link belongs to this org
    const existing = await database
      .select({ id: paymentLinks.id })
      .from(paymentLinks)
      .where(and(eq(paymentLinks.id, id), eq(paymentLinks.organizationId, organizationId)))
      .limit(1);

    if (!existing.length) {
      res.status(404).json({ success: false, message: "Payment link not found" });
      return;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.description !== undefined) patch.description = body.description;
    if (body.amount !== undefined) patch.amount = body.amount.toString();
    if (body.externalPaymentUrl !== undefined) patch.externalPaymentUrl = body.externalPaymentUrl;

    // If clientId changed, resolve client name
    if (body.clientId !== undefined) {
      const clientRows = await database
        .select({ id: clients.id, name: clients.name })
        .from(clients)
        .where(and(eq(clients.id, body.clientId), eq(clients.organizationId, organizationId)))
        .limit(1);
      if (!clientRows.length) {
        res.status(404).json({ success: false, message: "Client not found" });
        return;
      }
      patch.clientId = body.clientId;
      patch.clientname = clientRows[0].name;
    }

    // If projectId changed, resolve project name
    if (body.projectId !== undefined) {
      const projectRows = await database
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.organizationId, organizationId)))
        .limit(1);
      if (!projectRows.length) {
        res.status(404).json({ success: false, message: "Project not found" });
        return;
      }
      patch.projectId = body.projectId;
      patch.project = projectRows[0].name;
    }

    const [updated] = await database
      .update(paymentLinks)
      .set(patch as any)
      .where(and(eq(paymentLinks.id, id), eq(paymentLinks.organizationId, organizationId)))
      .returning();

    logger.info("Payment link updated:", { id: updated.id, organizationId, patch: Object.keys(patch) });

    res.status(200).json({
      success: true,
      message: "Payment link updated successfully",
      data: updated,
    });
  } catch (error) {
    logger.error("Error updating payment link:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update payment link",
    });
  }
};
