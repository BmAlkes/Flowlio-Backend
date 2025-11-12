import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { notifications } from "../../../drizzle/schema";
import status from "http-status";

export const deleteAllNotifications = async (
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

    // Delete all notifications for the user
    const deletedNotifications = await database
      .delete(notifications)
      .where(eq(notifications.userId, user.id))
      .returning();

    // logger.info(
    //   `Deleted ${deletedNotifications.length} notifications for user ${user.id}`
    // );

    res.status(status.OK).json({
      success: true,
      message: "All notifications deleted successfully",
      data: {
        deletedCount: deletedNotifications.length,
      },
    });
  } catch (error) {
    logger.error("Error deleting all notifications:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete all notifications",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
