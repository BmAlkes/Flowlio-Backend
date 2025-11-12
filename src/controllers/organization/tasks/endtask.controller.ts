import { database } from "@/configs/connection.config";
import { timeEntries, tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

export const endTask = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("📊 endTask called (organization)");

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

    // Find the active time entry for this task
    const activeTimeEntry = await database
      .select({
        id: timeEntries.id,
        startTime: timeEntries.startTime,
        taskId: timeEntries.taskId,
        taskTitle: tasks.title,
      })
      .from(timeEntries)
      .innerJoin(tasks, eq(timeEntries.taskId, tasks.id))
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(timeEntries.taskId, taskId),
          eq(timeEntries.userId, userId),
          eq(timeEntries.status, "active"),
          eq(projects.organizationId, organizationId)
        )
      )
      .limit(1);

    if (activeTimeEntry.length === 0) {
      res.status(404).json({
        success: false,
        message: "No active time tracking found for this task",
      });
      return;
    }

    const entry = activeTimeEntry[0];
    const endTime = new Date();
    const startTime = new Date(entry.startTime);
    const duration = Math.floor(
      (endTime.getTime() - startTime.getTime()) / (1000 * 60)
    ); // Duration in minutes

    // Update the time entry
    const updatedEntry = await database
      .update(timeEntries)
      .set({
        endTime,
        duration,
        status: "completed",
      })
      .where(eq(timeEntries.id, entry.id))
      .returning();

    // Log activity
    await logActivity({
      organizationId,
      actorId: userId,
      userId,
      type: "task",
      action: "end",
      resource: "task",
      resourceId: taskId,
      message: `Ended tracking task: ${entry.taskTitle}`,
      metadata: {
        timeEntryId: updatedEntry[0].id,
        duration: updatedEntry[0].duration,
      },
    });

    logger.info(`✅ Ended tracking task ${taskId} for user ${userId}`);

    res.status(200).json({
      success: true,
      message: "Task ended successfully",
      data: {
        timeEntryId: updatedEntry[0].id,
        startTime: updatedEntry[0].startTime,
        endTime: updatedEntry[0].endTime,
        duration: updatedEntry[0].duration,
        taskId,
        taskTitle: entry.taskTitle,
      },
    });
  } catch (error) {
    logger.error("Error ending task:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
