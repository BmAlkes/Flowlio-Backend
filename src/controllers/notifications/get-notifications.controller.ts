import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, desc, and } from "drizzle-orm";
import { notifications } from "../../../drizzle/schema";
import { z } from "zod";
import status from "http-status";

// Validation schema for query parameters
const getNotificationsSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  unreadOnly: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

export const getNotifications = async (
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

    // Validate query parameters
    const validationResult = getNotificationsSchema.safeParse(req.query);
    if (!validationResult.success) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Invalid query parameters",
        errors: validationResult.error.errors,
      });
      return;
    }

    const { page, limit, unreadOnly } = validationResult.data;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build where conditions
    let whereConditions: any[] = [eq(notifications.userId, user.id)];

    // Add unread filter if requested
    if (unreadOnly) {
      whereConditions.push(eq(notifications.read, false));
    }

    // Get notifications
    const userNotifications = await database.query.notifications.findMany({
      where:
        whereConditions.length > 1
          ? and(...whereConditions)
          : whereConditions[0],
      orderBy: [desc(notifications.createdAt)],
      limit: limitNum,
      offset: offset,
    });

    // Get total count for pagination
    const totalCount = await database
      .select({ count: notifications.id })
      .from(notifications)
      .where(
        whereConditions.length > 1
          ? and(...whereConditions)
          : whereConditions[0]
      );

    const totalNotifications = totalCount.length;
    const totalPages = Math.ceil(totalNotifications / limitNum);

    logger.info(
      `Retrieved ${userNotifications.length} notifications for user ${user.id}`
    );

    res.status(status.OK).json({
      success: true,
      message: "Notifications retrieved successfully",
      data: {
        notifications: userNotifications,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalNotifications,
          limit: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    logger.error("Error retrieving notifications:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve notifications",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
