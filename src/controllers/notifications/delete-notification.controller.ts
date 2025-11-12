import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and } from "drizzle-orm";
import { notifications } from "../../../drizzle/schema";
import status from "http-status";

export const deleteNotification = async (
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

    // Delete the notification
    const deletedNotification = await database
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)))
      .returning();

    if (!deletedNotification || deletedNotification.length === 0) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Notification not found",
      });
      return;
    }

    logger.info(`Notification ${id} deleted for user ${user.id}`);

    res.status(status.OK).json({
      success: true,
      message: "Notification deleted successfully",
      data: {
        id: deletedNotification[0].id,
      },
    });
  } catch (error) {
    logger.error("Error deleting notification:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete notification",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
