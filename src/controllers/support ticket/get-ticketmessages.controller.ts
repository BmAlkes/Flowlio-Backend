import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, asc } from "drizzle-orm";
import { supportTicketMessages } from "../../schema/schema";
import status from "http-status";

export const getSupportTicketMessages = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id: ticketId } = req.params;
  const user = req.user;

  try {
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    logger.info(`Fetching messages for ticket: ${ticketId}`);

    const messages = await database.query.supportTicketMessages.findMany({
      where: eq(supportTicketMessages.ticketId, ticketId),
      with: {
        sender: {
          columns: {
            image: true,
          },
        },
      },
      orderBy: [asc(supportTicketMessages.createdAt)],
    });

    res.status(status.OK).json({
      success: true,
      message: "Ticket messages fetched successfully",
      data: messages,
    });
  } catch (error) {
    logger.error("Error fetching ticket messages:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch ticket messages",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
