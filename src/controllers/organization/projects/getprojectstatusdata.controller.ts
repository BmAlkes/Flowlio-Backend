import { database } from "@/configs/connection.config";
import { projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getProjectStatusData = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getProjectStatusData called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // First, let's get all projects to see what statuses exist
    const allProjects = await database
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
      })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    logger.info(
      `🔍 Found ${allProjects.length} projects for organization ${organizationId}`
    );
    logger.info(
      `📊 Project statuses:`,
      allProjects.map((p) => ({ name: p.name, status: p.status }))
    );

    // Get project status counts for this organization
    const result = await database
      .select({
        ongoing: sql<number>`COUNT(CASE WHEN ${projects.status} IN ('ongoing', 'active') THEN 1 END)`,
        delayed: sql<number>`COUNT(CASE WHEN ${projects.status} = 'pending' THEN 1 END)`,
        finished: sql<number>`COUNT(CASE WHEN ${projects.status} = 'completed' THEN 1 END)`,
        total: sql<number>`COUNT(*)`,
      })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    const statusCounts = result[0] || {
      ongoing: 0,
      delayed: 0,
      finished: 0,
      total: 0,
    };

    // Get unique statuses for debug info
    const uniqueStatuses = [...new Set(allProjects.map((p) => p.status))];
    const statusBreakdown = uniqueStatuses.map((status) => ({
      status,
      count: allProjects.filter((p) => p.status === status).length,
    }));

    logger.info(
      `✅ Project status counts for organization ${organizationId}: ${JSON.stringify(
        statusCounts
      )}`
    );
    logger.info(`🔍 Unique statuses found: ${uniqueStatuses.join(", ")}`);
    logger.info(`📊 Status breakdown:`, statusBreakdown);

    res.status(200).json({
      success: true,
      message: "Project status data fetched successfully",
      data: {
        ongoing: statusCounts.ongoing,
        delayed: statusCounts.delayed,
        finished: statusCounts.finished,
        total: statusCounts.total,
        // Include debug info in response for frontend
        debug: {
          allStatuses: uniqueStatuses.join(", "),
          statusCounts: statusBreakdown,
          allProjects: allProjects.map((p) => ({
            name: p.name,
            status: p.status,
          })),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching project status data:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
