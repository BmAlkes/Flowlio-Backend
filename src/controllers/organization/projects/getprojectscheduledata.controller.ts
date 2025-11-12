import { database } from "@/configs/connection.config";
import { projects, tasks } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getProjectScheduleData = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getProjectScheduleData called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get all projects with task counts for this organization (no date filtering on backend)
    // Frontend will handle the date filtering
    const projectsWithTaskCounts = await database
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        status: projects.status,
        createdAt: projects.createdAt, // Include creation date for frontend filtering
        completedTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' THEN 1 END)`,
        inProgressTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} IN ('in_progress', 'todo', 'updated') THEN 1 END)`,
        delayedTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} IN ('delay', 'changes') THEN 1 END)`,
        totalTasks: sql<number>`COUNT(${tasks.id})`,
      })
      .from(projects)
      .leftJoin(tasks, eq(projects.id, tasks.projectId))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(
        projects.id,
        projects.name,
        projects.projectNumber,
        projects.status,
        projects.createdAt
      )
      .orderBy(projects.createdAt);

    logger.info(
      `✅ Fetched ${projectsWithTaskCounts.length} projects with task counts for organization ${organizationId}`
    );

    res.status(200).json({
      success: true,
      message: "Project schedule data fetched successfully",
      data: projectsWithTaskCounts,
    });
  } catch (error) {
    logger.error("Error fetching project schedule data:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
