import { database } from "@/configs/connection.config";
import { timeEntries, tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import status from "http-status";

export const getAllTimeEntries = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getAllTimeEntries called (organization)");

    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(400).json({
        success: false,
        message: "User ID and Organization ID are required",
      });
      return;
    }

    // Get all time entries for the user within their organization
    const allEntries = await database
      .select({
        id: timeEntries.id,
        userId: timeEntries.userId,
        projectId: timeEntries.projectId,
        taskId: timeEntries.taskId,
        startTime: timeEntries.startTime,
        endTime: timeEntries.endTime,
        duration: timeEntries.duration,
        description: timeEntries.description,
        status: timeEntries.status,
        createdAt: timeEntries.createdAt,
        updatedAt: timeEntries.updatedAt,
        taskTitle: tasks.title,
        projectName: projects.name,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(timeEntries.userId, userId),
          eq(projects.organizationId, organizationId)
        )
      )
      .orderBy(desc(timeEntries.createdAt));

    logger.info(
      `✅ Found ${allEntries.length} time entries for user ${userId}`
    );

    res.status(200).json({
      success: true,
      message: "Time entries retrieved successfully",
      data: allEntries,
    });
  } catch (error) {
    logger.error("Error fetching time entries:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
