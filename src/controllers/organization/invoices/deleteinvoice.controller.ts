import { Request, Response } from "express";
import { invoices } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

export interface DeleteInvoiceRequest {
  params: {
    id: string;
  };
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const deleteInvoice = async (
  req: DeleteInvoiceRequest & Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

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

    // Check if invoice exists and belongs to the organization
    const existingInvoice = await database
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, req.user!.organizationId as string)
        )
      )
      .limit(1);

    if (existingInvoice.length === 0) {
      res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
      return;
    }

    // Log activity before deletion
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;
    if (organizationId && userId && existingInvoice[0]) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "invoice",
        action: "delete",
        resource: "invoice",
        resourceId: id,
        message: `Deleted invoice: ${existingInvoice[0].invoiceNumber}`,
        metadata: { clientname: existingInvoice[0].clientname },
      });
    }

    // Delete the invoice
    await database
      .delete(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, req.user!.organizationId as string)
        )
      );

    logger.info("Invoice deleted successfully:", {
      invoiceId: id,
      userId: req.user!.id,
      organizationId: req.user!.organizationId,
    });

    res.status(200).json({
      success: true,
      message: "Invoice deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting invoice:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete invoice",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
