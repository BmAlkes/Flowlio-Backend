import { database } from "@/configs/connection.config";
import { timeEntries, tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";

export const getActiveTimeEntries = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getActiveTimeEntries called");

    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(400).json({
        success: false,
        message: "User ID and Organization ID are required",
      });
      return;
    }

    // Get active time entries for this user
    const activeEntries = await database
      .select({
        id: timeEntries.id,
        taskId: timeEntries.taskId,
        startTime: timeEntries.startTime,
        description: timeEntries.description,
        taskTitle: tasks.title,
        projectName: projects.name,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(timeEntries.userId, userId),
          eq(timeEntries.status, "active"),
          eq(projects.organizationId, organizationId)
        )
      );

    logger.info(
      `✅ Found ${activeEntries.length} active time entries for user ${userId}`
    );

    res.status(200).json({
      success: true,
      message: "Active time entries fetched successfully",
      data: activeEntries,
    });
  } catch (error) {
    logger.error("Error fetching active time entries:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
