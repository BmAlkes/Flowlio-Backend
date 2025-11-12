import { database } from "@/configs/connection.config";
import { timeEntries, tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { randomUUID } from "crypto";
import { logActivity } from "@/utils/activity.util";

export const startTask = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("📊 startTask called (organization)");

    const taskId = req.params.id;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!taskId || !userId || !organizationId) {
      res.status(400).json({
        success: false,
        message: "Task ID, User ID, and Organization ID are required",
      });
      return;
    }

    // Verify the task exists and belongs to the user's organization
    // NOTE: For organization users, we only check organization membership, not assignment
    const task = await database
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: tasks.title,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(eq(tasks.id, taskId), eq(projects.organizationId, organizationId))
      )
      .limit(1);

    if (task.length === 0) {
      res.status(404).json({
        success: false,
        message: "Task not found or not accessible in your organization",
      });
      return;
    }

    // Check if there's already an active time entry for this task
    const activeTimeEntry = await database
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.taskId, taskId),
          eq(timeEntries.userId, userId),
          eq(timeEntries.status, "active")
        )
      )
      .limit(1);

    if (activeTimeEntry.length > 0) {
      res.status(409).json({
        success: false,
        message: "Task is already being tracked",
      });
      return;
    }

    // Create new time entry
    const newTimeEntry = await database
      .insert(timeEntries)
      .values({
        id: randomUUID(),
        userId,
        projectId: task[0].projectId,
        taskId,
        startTime: new Date(),
        status: "active",
        description: `Working on: ${task[0].title}`,
      })
      .returning();

    // Log activity
    await logActivity({
      organizationId,
      actorId: userId,
      userId,
      type: "task",
      action: "start",
      resource: "task",
      resourceId: taskId,
      message: `Started tracking task: ${task[0].title}`,
      metadata: { timeEntryId: newTimeEntry[0].id },
    });

    logger.info(`✅ Started tracking task ${taskId} for user ${userId}`);

    res.status(200).json({
      success: true,
      message: "Task started successfully",
      data: {
        timeEntryId: newTimeEntry[0].id,
        startTime: newTimeEntry[0].startTime,
        taskId,
        taskTitle: task[0].title,
      },
    });
  } catch (error) {
    logger.error("Error starting task:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
