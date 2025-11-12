import { Response } from "express";
import { invoices } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { createInvoiceSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";
import { z } from "zod";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import { logActivity } from "@/utils/activity.util";

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
  res: Response
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

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    // Get client information
    const organizationId = req.user.organizationId as string;

    const client = await database.query.clients.findFirst({
      where: (clients, { eq, and }) =>
        and(
          eq(clients.id, validatedData.clientId),
          eq(clients.organizationId, organizationId)
        ),
    });

    if (!client) {
      res.status(404).json({
        success: false,
        message: "Client not found",
      });
      return;
    }

    // Generate simple sequential invoice number
    const invoiceCount = await database.query.invoices.findMany({
      where: (invoices, { eq }) => eq(invoices.organizationId, organizationId),
    });

    const nextNumber = (invoiceCount.length + 1).toString().padStart(5, "0");
    const invoiceNumber = `S1-${nextNumber}`;

    // Handle PDF upload if provided
    let pdfUrl = null;
    let pdfFileName = null;
    let pdfFileSize = null;

    // Handle PDF upload if provided
    if (
      validatedData.pdfFile &&
      validatedData.pdfFileName &&
      typeof validatedData.pdfFile === "string" &&
      validatedData.pdfFile.startsWith("data:")
    ) {
      try {
        const uploadResult = await uploadToCloudinary(
          validatedData.pdfFile,
          "invoices"
        );
        pdfUrl = uploadResult.secure_url;
        pdfFileName = validatedData.pdfFileName;
        pdfFileSize = uploadResult.bytes;
      } catch (uploadError) {
        logger.error("PDF upload failed:", uploadError);
        pdfUrl = null;
        pdfFileName = null;
        pdfFileSize = null;
      }
    } else {
      logger.info(
        "No PDF file provided or invalid format, creating invoice without PDF"
      );
    }

    // Create invoice
    const invoiceData = {
      id: randomUUID(),
      organizationId: organizationId,
      clientId: validatedData.clientId,
      createdBy: req.user.id,
      invoiceNumber: invoiceNumber,
      clientname: client.name,
      amount: validatedData.amount.toString(),
      status: "draft",
      description: validatedData.description || null,
      dueDate: validatedData.dueDate ? new Date(validatedData.dueDate) : null,
      pdfUrl: pdfUrl,
      pdfFileName: pdfFileName,
      pdfFileSize: pdfFileSize,
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
        message: `Created invoice: ${invoiceNumber} for ${client.name}`,
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
