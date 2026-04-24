import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { invoices } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const updateInvoiceStatus = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { organizationId } = req.user as any;
    const { id } = req.params;
    const { status: invoiceStatus } = req.body;

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "Unauthorized",
      });
      return;
    }

    if (!invoiceStatus || !["draft", "paid", "cancelled", "sent"].includes(invoiceStatus.toLowerCase())) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Invalid status provided",
      });
      return;
    }

    const [updatedInvoice] = await database
      .update(invoices)
      .set({
        status: invoiceStatus.toLowerCase(),
      })
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, organizationId)
        )
      )
      .returning();

    if (!updatedInvoice) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Invoice not found or unauthorized",
      });
      return;
    }

    res.status(status.OK).json({
      success: true,
      message: "Invoice status updated successfully",
      data: updatedInvoice,
    });
  } catch (error) {
    logger.error("Error updating invoice status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
    });
  }
};
