import { database } from "@/configs/connection.config";
import { timeEntries, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getOrganizationWeeklyHoursTracked = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("📊 getOrganizationWeeklyHoursTracked called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get current week's start and end dates
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
    endOfWeek.setHours(23, 59, 59, 999);

    logger.info(
      `📊 Week range: ${startOfWeek.toISOString()} to ${endOfWeek.toISOString()}`,
    );

    // Get total hours tracked for this organization's projects this week
    const result = await database
      .select({
        weeklyHours: sql<number>`SUM(${timeEntries.duration}) / 60.0`, // Convert minutes to hours
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(
        sql`${projects.organizationId} = ${organizationId} 
            AND ${timeEntries.createdAt} >= ${startOfWeek.toISOString()} 
            AND ${timeEntries.createdAt} <= ${endOfWeek.toISOString()}`,
      );

    const weeklyHours = result[0]?.weeklyHours || 0;

    logger.info(
      `✅ Weekly hours tracked for organization ${organizationId}: ${weeklyHours}`,
    );

    res.status(200).json({
      success: true,
      message: "Weekly hours tracked fetched successfully",
      data: {
        weeklyHours,
        weekStart: startOfWeek.toISOString(),
        weekEnd: endOfWeek.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error fetching weekly hours tracked:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
