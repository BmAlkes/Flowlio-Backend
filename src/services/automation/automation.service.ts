import { database } from "../../configs/connection.config";
import { tasks, projects, notifications, users } from "../../schema/schema";
import { eq, and, lt, ne, sql, gte, count, isNull } from "drizzle-orm";
import { logger } from "../../utils/logger.util";
import { sendTransactionalEmail } from "../email/transactional.service";
import { env } from "../../utils/env.util";
import crypto from "crypto";

export class AutomationService {
  /**
   * Recalculates and updates project progress based on task completion
   */
  async recalculateProjectProgress(projectId: string): Promise<number> {
    try {
      logger.info(`🔄 Recalculating progress for project: ${projectId}`);

      // Get total task count
      const totalTasksResult = await database
        .select({ count: count() })
        .from(tasks)
        .where(eq(tasks.projectId, projectId));

      const totalTasks = totalTasksResult[0]?.count || 0;

      if (totalTasks === 0) {
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
  }

  /**
   * Marks overdue tasks as 'delay', creates in-app notifications, and sends
   * a one-time email to the assignee and the project manager.
   * Runs daily via cron.
   */
  async handleOverdueTasks(): Promise<void> {
    const now = new Date();
    logger.info("Running overdue task automation check...");

    try {
      const overdueTasks = await database
        .select({
          id: tasks.id,
          title: tasks.title,
          endDate: tasks.endDate,
          assignedTo: tasks.assignedTo,
          overdueNotifiedAt: tasks.overdueNotifiedAt,
          projectId: tasks.projectId,
          projectName: projects.name,
          projectManagerId: projects.assignedTo,
          organizationId: projects.organizationId,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            ne(tasks.status, "completed"),
            lt(tasks.endDate, now),
            isNull(tasks.overdueNotifiedAt),
          ),
        );

      logger.info(`Found ${overdueTasks.length} overdue tasks to process.`);

      const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";

      for (const task of overdueTasks) {
        // 1. Mark status as 'delay' if not already
        await database
          .update(tasks)
          .set({ status: "delay", overdueNotifiedAt: now, updatedAt: now })
          .where(eq(tasks.id, task.id));

        const endDateFormatted = task.endDate
          ? new Date(task.endDate).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "Unknown";
        const taskUrl = `${frontendUrl}/projects/${task.projectId}/tasks/${task.id}`;

        // 2. Collect recipient IDs (assignee + project manager, deduplicated)
        const recipientIds = Array.from(
          new Set(
            [task.assignedTo, task.projectManagerId].filter(Boolean) as string[],
          ),
        );

        for (const userId of recipientIds) {
          // Fetch user email
          const userRows = await database
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          const user = userRows[0];
          if (!user?.email) continue;

          // 3. In-app notification
          await this.createNotification({
            userId: user.id,
            organizationId: task.organizationId,
            type: "task_overdue",
            title: "Task Overdue",
            message: `Task "${task.title}" in project "${task.projectName}" is overdue.`,
            data: { taskId: task.id, projectId: task.projectId },
          });

          // 4. Transactional email (fire-and-forget, errors logged inside)
          await sendTransactionalEmail({
            to: user.email,
            toName: user.name ?? undefined,
            templateKey: "task_overdue",
            data: {
              assigneeName: user.name ?? user.email,
              taskTitle: task.title,
              projectName: task.projectName ?? "Unknown project",
              endDate: endDateFormatted,
              taskUrl,
            },
          });
        }
      }

      logger.info(`Overdue task automation completed. Processed ${overdueTasks.length} tasks.`);
    } catch (error) {
      logger.error("Error in overdue task automation:", error);
    }
  }

  /**
   * Checks projects near their end date and sends reminders
   * Runs daily via cron
   */
  async handleProjectEndReminders(): Promise<void> {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    logger.info("Running project end date reminder check...");

    try {
      // Find projects ending in the next 3 days that are not 100% complete
      const projectsToRemind = await database
        .select({
          id: projects.id,
          name: projects.name,
          organizationId: projects.organizationId,
          assignedTo: projects.assignedTo,
          endDate: projects.endDate,
          progress: projects.progress,
        })
        .from(projects)
        .where(
          and(
            lt(projects.endDate, threeDaysFromNow),
            gte(projects.endDate, now),
            lt(projects.progress, 100),
          ),
        );

      for (const project of projectsToRemind) {
        if (!project.assignedTo) continue;

        // Check if reminder was already sent in the last 24 hours to avoid duplicates
        const lastReminder = await database
          .select()
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, project.assignedTo),
              eq(notifications.type, "project_reminder"),
              sql`${notifications.data}->>'projectId' = ${project.id}`,
              gte(
                notifications.createdAt,
                new Date(now.getTime() - 24 * 60 * 60 * 1000),
              ),
            ),
          )
          .limit(1);

        if (lastReminder.length === 0) {
          await this.createNotification({
            userId: project.assignedTo,
            organizationId: project.organizationId,
            type: "project_reminder",
            title: "Project Ending Soon",
            message: `Project "${project.name}" is due on ${project.endDate?.toLocaleDateString()}. Current progress is ${project.progress}%.`,
            data: { projectId: project.id },
          });
        }
      }
    } catch (error) {
      logger.error("Error in project reminder automation:", error);
    }
  }

  /**
   * Automatically assigns a task to the project's assignee if enabled
   */
  async handleAutoAssignTask(projectId: string, taskId: string): Promise<void> {
    try {
      const project = await database.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });

      if (project?.settings?.autoAssignTasks && project.assignedTo) {
        await database
          .update(tasks)
          .set({ assignedTo: project.assignedTo, updatedAt: new Date() })
          .where(eq(tasks.id, taskId));

        logger.info(
          `Auto-assigned task ${taskId} to user ${project.assignedTo} for project ${projectId}`,
        );
      }
    } catch (error) {
      logger.error(`Error in auto-assigning task ${taskId}:`, error);
    }
  }

  /**
   * Helper to create notifications
   */
  private async createNotification(params: {
    userId: string;
    organizationId: string | null;
    type: string;
    title: string;
    message: string;
    data?: any;
  }): Promise<void> {
    try {
      await database.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: params.userId,
        organizationId: params.organizationId,
        type: params.type,
        title: params.title,
        message: params.message,
        data: params.data,
        read: false,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error("Error creating notification:", error);
    }
  }
}

export const automationService = new AutomationService();
