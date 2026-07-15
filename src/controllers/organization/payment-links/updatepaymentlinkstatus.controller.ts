import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { paymentLinks } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { updatePaymentLinkStatusSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { z } from "zod";

export const updatePaymentLinkStatus = async (
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

    const bodyResult = updatePaymentLinkStatusSchema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: bodyResult.error.errors,
      });
      return;
    }

    const [updated] = await database
      .update(paymentLinks)
      .set({ status: bodyResult.data.status, updatedAt: new Date() })
      .where(
        and(
          eq(paymentLinks.id, id),
          eq(paymentLinks.organizationId, organizationId),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, message: "Payment link not found" });
      return;
    }

    logger.info("Payment link status updated:", {
      id: updated.id,
      status: updated.status,
      organizationId,
    });

    res.status(200).json({
      success: true,
      message: "Payment link status updated",
      data: { id: updated.id, status: updated.status },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ success: false, message: "Validation failed", errors: error.errors });
      return;
    }
    logger.error("Error updating payment link status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update payment link status",
    });
  }
};
