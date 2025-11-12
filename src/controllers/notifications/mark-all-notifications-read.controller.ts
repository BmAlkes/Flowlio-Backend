import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { notifications } from "../../../drizzle/schema";
import status from "http-status";

export const markAllNotificationsAsRead = async (
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

    // Update all unread notifications for the user
    const updatedNotifications = await database
      .update(notifications)
      .set({
        read: true,
        readAt: new Date().toISOString(),
      })
      .where(eq(notifications.userId, user.id))
      .returning();

    logger.info(
      `Marked ${updatedNotifications.length} notifications as read for user ${user.id}`
    );

    res.status(status.OK).json({
      success: true,
      message: "All notifications marked as read",
      data: {
        updatedCount: updatedNotifications.length,
      },
    });
  } catch (error) {
    logger.error("Error marking all notifications as read:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to mark all notifications as read",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
