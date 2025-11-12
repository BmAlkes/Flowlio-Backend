import { database } from "@/configs/connection.config";
import { timeEntries, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getOrganizationHoursTracked = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getOrganizationHoursTracked called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get total hours tracked for this organization's projects
    const result = await database
      .select({
        totalHours: sql<number>`SUM(${timeEntries.duration})`,
      })
      .from(timeEntries)
      .innerJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(eq(projects.organizationId, organizationId));

    const totalHours = result[0]?.totalHours || 0;

    logger.info(
      `✅ Total hours tracked for organization ${organizationId}: ${totalHours}`
    );

    res.status(200).json({
      success: true,
      message: "Total hours tracked fetched successfully",
      data: {
        totalHours,
      },
    });
  } catch (error) {
    logger.error("Error fetching total hours tracked:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
