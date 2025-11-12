import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and } from "drizzle-orm";
import { notifications } from "../../../drizzle/schema";
import status from "http-status";

export const markNotificationAsRead = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id } = req.params;

    if (!id) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Notification ID is required",
      });
      return;
    }

    // Update notification to mark as read
    const [updatedNotification] = await database
      .update(notifications)
      .set({
        read: true,
        readAt: new Date().toISOString(),
      })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();

    if (!updatedNotification) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Notification not found",
      });
      return;
    }

    logger.info(`Notification ${id} marked as read for user ${user.id}`);

    res.status(status.OK).json({
      success: true,
      message: "Notification marked as read",
      data: updatedNotification,
    });
  } catch (error) {
    logger.error("Error marking notification as read:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
