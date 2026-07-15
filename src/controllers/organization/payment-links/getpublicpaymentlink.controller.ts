import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { paymentLinks, organizations } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const getPublicPaymentLink = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({ success: false, message: "Payment link ID is required" });
      return;
    }

    const rows = await database
      .select({
        id: paymentLinks.id,
        description: paymentLinks.description,
        project: paymentLinks.project,
        clientname: paymentLinks.clientname,
        amount: paymentLinks.amount,
        status: paymentLinks.status,
        externalPaymentUrl: paymentLinks.externalPaymentUrl,
        organizationId: paymentLinks.organizationId,
      })
      .from(paymentLinks)
      .where(eq(paymentLinks.id, id))
      .limit(1);

    if (!rows.length) {
      res.status(404).json({ success: false, message: "Payment link not found" });
      return;
    }

    const link = rows[0];

    // Resolve organization name without leaking organizationId in the response
    const orgRows = await database
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, link.organizationId))
      .limit(1);

    const organizationName = orgRows[0]?.name ?? null;

    res.status(200).json({
      success: true,
      data: {
        id: link.id,
        organizationName,
        project: link.project,
        clientname: link.clientname,
        description: link.description,
        amount: link.amount,
        status: link.status ?? "unpaid",
        externalPaymentUrl: link.externalPaymentUrl,
      },
    });
  } catch (error) {
    logger.error("Error fetching public payment link:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch payment link",
    });
  }
};
