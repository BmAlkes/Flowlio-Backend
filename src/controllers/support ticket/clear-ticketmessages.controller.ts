import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { supportTicketMessages } from "../../schema/schema";
import status from "http-status";

export const clearTicketMessages = async (
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

    // Only allow org owners, superadmins, or subadmins to clear chat
    const isAuthorized = 
      user.role === "superadmin" || 
      user.role === "subadmin" || 
      user.isOrganizationOwner;

    if (!isAuthorized) {
       res.status(status.FORBIDDEN).json({
        success: false,
        message: "You are not authorized to clear this chat",
      });
      return;
    }

    logger.info(`Clearing all messages for ticket: ${ticketId}`);

    await database.delete(supportTicketMessages).where(eq(supportTicketMessages.ticketId, ticketId));

    res.status(status.OK).json({
      success: true,
      message: "Chat history cleared successfully",
    });
  } catch (error) {
    logger.error("Error clearing ticket messages:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to clear chat history",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
