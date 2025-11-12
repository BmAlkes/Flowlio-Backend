import { database } from "@/configs/connection.config";
import { timeEntries, tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

export const endTask = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("📊 endTask called");

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
      .select()
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

    const timeEntry = activeTimeEntry[0].time_entries;
    const endTime = new Date();
    const duration = Math.floor(
      (endTime.getTime() - timeEntry.startTime.getTime()) / (1000 * 60)
    ); // in minutes

    // Update the time entry
    const updatedTimeEntry = await database
      .update(timeEntries)
      .set({
        endTime,
        duration,
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(timeEntries.id, timeEntry.id))
      .returning();

    // Log activity
    if (organizationId) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId,
        type: "task",
        action: "end",
        resource: "task",
        resourceId: taskId,
        message: `Ended tracking task: ${activeTimeEntry[0].tasks.title}`,
        metadata: { timeEntryId: updatedTimeEntry[0].id, duration },
      });
    }

    logger.info(
      `✅ Ended tracking task ${taskId} for user ${userId}. Duration: ${duration} minutes`
    );

    res.status(200).json({
      success: true,
      message: "Task ended successfully",
      data: {
        timeEntryId: updatedTimeEntry[0].id,
        startTime: updatedTimeEntry[0].startTime,
        endTime: updatedTimeEntry[0].endTime,
        duration: updatedTimeEntry[0].duration,
        taskId,
        taskTitle: activeTimeEntry[0].tasks.title,
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
