import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { users } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const updateUserTimezone = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { timezone } = req.body;
    logger.info("Timezone update request:", { userId: req.user.id, timezone });

    if (!timezone) {
      res.status(400).json({
        success: false,
        message: "Timezone is required",
      });
      return;
    }

    // Validate timezone format (basic validation)
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: "Invalid timezone format",
      });
      return;
    }

    // Update user timezone
    await database
      .update(users)
      .set({
        timezone: timezone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, req.user.id));

    logger.info("User timezone updated successfully:", {
      userId: req.user.id,
      timezone: timezone,
    });

    res.status(200).json({
      success: true,
      message: "Timezone updated successfully",
      data: {
        timezone: timezone,
      },
    });
  } catch (error) {
    logger.error("Error updating user timezone:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update timezone",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
