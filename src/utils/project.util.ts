import { database } from "@/configs/connection.config";
import { projects, tasks } from "@/schema/schema";
import { eq, count, and } from "drizzle-orm";
import { logger } from "./logger.util";

/**
 * Recalculates the progress of a project based on the status of its tasks.
 * Progress is calculated as (completed tasks / total tasks) * 100.
 * If there are no tasks, progress is 0.
 *
 * @param projectId The ID of the project to recalculate progress for
 */
export const recalculateProjectProgress = async (
  projectId: string,
): Promise<number> => {
  try {
    logger.info(`🔄 Recalculating progress for project: ${projectId}`);

    // Get total task count
    const totalTasksResult = await database
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.projectId, projectId));

    const totalTasks = totalTasksResult[0]?.count || 0;

    if (totalTasks === 0) {
      // If there are no tasks, progress is 0 or stay as is?
      // Usually 0 is safe for new projects.
      await database
        .update(projects)
        .set({ progress: 0, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
      return 0;
    }

    // Get completed task count
    const completedTasksResult = await database
      .select({ count: count() })
      .from(tasks)
      .where(
        and(eq(tasks.projectId, projectId), eq(tasks.status, "completed")),
      );

    const completedTasks = completedTasksResult[0]?.count || 0;

    // Calculate progress percentage
    const progress = Math.round((completedTasks / totalTasks) * 100);

    logger.info(
      `📊 Project ${projectId}: ${completedTasks}/${totalTasks} tasks completed. Progress: ${progress}%`,
    );

    // Update project progress
    await database
      .update(projects)
      .set({
        progress,
        updatedAt: new Date(),
        // Automatically mark as completed if progress is 100%?
        // User said: "while the status is completed the why it show 0 progress"
        // This implies they manually set status to completed but progress didn't update.
        // Or they want it to be automatic. Let's stick to progress for now.
      })
      .where(eq(projects.id, projectId));

    return progress;
  } catch (error) {
    logger.error(
      `❌ Error recalculating progress for project ${projectId}:`,
      error,
    );
    throw error;
  }
};
