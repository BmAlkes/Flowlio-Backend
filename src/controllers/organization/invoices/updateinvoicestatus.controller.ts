import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { invoices, revenueEntries } from "@/schema/schema";
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
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Unauthorized" });
      return;
    }

    const normalizedStatus = invoiceStatus?.toLowerCase();
    if (!normalizedStatus || !["draft", "paid", "cancelled", "sent"].includes(normalizedStatus)) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "Invalid status provided" });
      return;
    }

    const now = new Date();

    const [updatedInvoice] = await database
      .update(invoices)
      .set({
        status: normalizedStatus,
        datepaid: normalizedStatus === "paid" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(invoices.id, id), eq(invoices.organizationId, organizationId)))
      .returning();

    if (!updatedInvoice) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Invoice not found or unauthorized" });
      return;
    }

    // Sync revenue_entries: insert when paid, delete when un-paid
    if (normalizedStatus === "paid") {
      const dateStr = now.toISOString().split("T")[0];
      await database
        .insert(revenueEntries)
        .values({
          organizationId,
          date: dateStr,
          amount: updatedInvoice.amount ?? "0",
          currency: "USD",
          category: "service",
          source: "invoice",
          description: updatedInvoice.invoiceNumber ?? null,
          clientId: updatedInvoice.clientId ?? null,
          invoiceId: id,
          createdBy: (req as any).user?.id,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: revenueEntries.invoiceId,
          set: { amount: updatedInvoice.amount ?? "0", date: dateStr, updatedAt: now },
        });
    } else {
      // Remove revenue entry if invoice is un-paid
      await database.delete(revenueEntries).where(eq(revenueEntries.invoiceId, id));
    }

    res.status(status.OK).json({
      success: true,
      message: "Invoice status updated successfully",
      data: updatedInvoice,
    });
  } catch (error) {
    logger.error("Error updating invoice status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};
