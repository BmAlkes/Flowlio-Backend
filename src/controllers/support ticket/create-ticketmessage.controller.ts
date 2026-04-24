import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { supportTicketMessages, supportTickets } from "../../schema/schema";
import status from "http-status";
import crypto from "crypto";

export const createTicketMessage = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id: ticketId } = req.params;
  const { message } = req.body;
  const user = req.user;

  try {
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!message || message.trim() === "") {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Message content is required",
      });
      return;
    }

    logger.info(`Creating message for ticket: ${ticketId} by user: ${user.id}`);

    // Insert message
    const [newMessage] = await database
      .insert(supportTicketMessages)
      .values({
        id: crypto.randomUUID(),
        ticketId,
        senderId: user.id,
        senderRole: user.role,
        senderName: user.name || "Unknown User",
        message,
        createdAt: new Date(),
      })
      .returning();

    // Update ticket's updatedAt timestamp
    await database
      .update(supportTickets)
      .set({ updatedAt: new Date() })
      .where(eq(supportTickets.id, ticketId));

    res.status(status.CREATED).json({
      success: true,
      message: "Ticket message created successfully",
      data: newMessage,
    });
  } catch (error) {
    logger.error("Error creating ticket message:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create ticket message",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
