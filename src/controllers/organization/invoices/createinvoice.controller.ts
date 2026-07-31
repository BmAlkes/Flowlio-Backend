import { Response } from "express";
import { eq, sql } from "drizzle-orm";
import { invoices } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { createInvoiceSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";
import { z } from "zod";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import { logActivity } from "@/utils/activity.util";
import { requireOrganizationId } from "@/utils/organization.util";
import { canCreateInvoice } from "@/utils/plan-access.util";

interface CreateInvoiceRequest {
  body: z.infer<typeof createInvoiceSchema>;
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const createInvoice = async (
  req: CreateInvoiceRequest,
  res: Response,
): Promise<void> => {
  try {
    // Validate request body
    const validatedData = createInvoiceSchema.parse(req.body);

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Get organization ID from authenticated user
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) {
      return; // Response already sent by requireOrganizationId
    }

    const invoiceAccess = await canCreateInvoice(organizationId);
    if (!invoiceAccess.hasAccess) {
      res.status(403).json({ success: false, message: invoiceAccess.reason });
      return;
    }

    const client = await database.query.clients.findFirst({
      where: (clients, { eq, and }) =>
        and(
          eq(clients.id, validatedData.clientId),
          eq(clients.organizationId, organizationId),
        ),
    });

    if (!client) {
      res.status(404).json({
        success: false,
        message: "Client not found",
      });
      return;
    }

    // Generate sequential invoice number for this organization
    const [{ count }] = await database
      .select({ count: sql<number>`count(*)` })
      .from(invoices)
      .where(eq(invoices.organizationId, organizationId));

    const nextNumber = (Number(count) + 1).toString().padStart(5, "0");
    const invoiceNumber = `S1-${nextNumber}`;

    // Handle PDF upload if provided
    let pdfUrl = null;
    let pdfFileName = null;
    let pdfFileSize = null;

    if (
      validatedData.pdfFile &&
      validatedData.pdfFileName &&
      typeof validatedData.pdfFile === "string" &&
      validatedData.pdfFile.startsWith("data:")
    ) {
      try {
        const uploadResult = await uploadToCloudinary(
          validatedData.pdfFile,
          "invoices",
        );
        pdfUrl = uploadResult.secure_url;
        pdfFileName = validatedData.pdfFileName;
        pdfFileSize = uploadResult.bytes;
      } catch (uploadError) {
        logger.error("PDF upload failed:", uploadError);
      }
    }

    // Create invoice
    const invoiceData = {
      id: randomUUID(),
      organizationId: organizationId,
      clientId: validatedData.clientId,
      createdBy: req.user.id,
      invoiceNumber: invoiceNumber,
      clientname: client.name.trim(),
      amount: validatedData.amount.toString(),
      status: "draft",
      description: validatedData.description || null,
      dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
      pdfUrl: pdfUrl,
      pdfFileName: pdfFileName,
      pdfFileSize: pdfFileSize,
      paymentUrl: validatedData.paymentUrl || null,
    };

    const [newInvoice] = await database
      .insert(invoices)
      .values(invoiceData)
      .returning();

    const userId = req.user?.id;
    if (organizationId && userId) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "invoice",
        action: "create",
        resource: "invoice",
        resourceId: newInvoice.id,
        message: `Created invoice: ${invoiceNumber} for ${client.name.trim()}`,
        metadata: {
          amount: validatedData.amount,
          clientId: validatedData.clientId,
        },
      });
    }

    res.status(201).json({
      success: true,
      message: "Invoice created successfully",
      data: newInvoice,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
      return;
    }

    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create invoice",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
