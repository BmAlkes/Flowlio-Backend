import { Request, Response } from "express";
import { calendarEvents } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and, gte, lte } from "drizzle-orm";

interface GetCalendarEventsRequest extends Request {
  user?: {
    id: string;
    organizationId?: string;
    role: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isSuperAdmin: boolean;
    createdAt: Date;
    updatedAt: Date;
    organization?: any;
    userOrganization?: any;
  };
}

export const getCalendarEvents = async (
  req: GetCalendarEventsRequest,
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

    const { organizationId } = req.user;
    const { startDate, endDate, calendarType } = req.query;

    // Build query conditions
    let conditions = [
      eq(calendarEvents.organizationId, organizationId as string),
    ];

    // Add date range filter if provided
    if (startDate && endDate) {
      conditions.push(
        gte(calendarEvents.date, new Date(startDate as string)),
        lte(calendarEvents.date, new Date(endDate as string))
      );
    }

    // Add calendar type filter if provided
    if (calendarType) {
      conditions.push(
        eq(
          calendarEvents.calendarType,
          calendarType as "work" | "education" | "personal"
        )
      );
    }

    // Fetch calendar events
    const events = await database
      .select()
      .from(calendarEvents)
      .where(and(...conditions))
      .orderBy(calendarEvents.date, calendarEvents.startHour);

    res.status(200).json({
      success: true,
      message: "Calendar events retrieved successfully",
      data: events,
    });
  } catch (error) {
    logger.error("Error fetching calendar events:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch calendar events",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
