import { database } from "../../configs/connection.config";
import { tasks, projects, notifications, users, userOrganizations } from "../../schema/schema";
import { eq, and, lt, ne, sql, gte, count, isNull, or } from "drizzle-orm";

// How often to re-send overdue reminders for tasks that remain unresolved.
// Future: make this configurable per organization.
const OVERDUE_REMINDER_INTERVAL_DAYS = 7;
import { logger } from "../../utils/logger.util";
import { sendTransactionalEmail, EmailResult } from "../email/transactional.service";
import { env } from "../../utils/env.util";
import crypto from "crypto";

export class AutomationService {
  private async getOrgOwnerUser(
    organizationId: string,
  ): Promise<{ id: string; name: string | null; email: string } | null> {
    // Role priority: ownership roles first, then admin, then any active member
    // Covers all creation paths: "org" (legacy), "owner" (newer), plus orgs with only admin/member
    for (const role of ["org", "owner", "admin", "user", "member"]) {
      const rows = await database
        .select({ id: users.id, name: users.name, email: users.email })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(
          and(
            eq(userOrganizations.organizationId, organizationId),
            eq(userOrganizations.role, role),
          ),
        )
        .limit(1);
      if (rows[0]) return rows[0];
    }
    return null;
  }

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
   * Runs daily via cron. Returns a result object for observability.
   */
  async handleOverdueTasks(): Promise<{
    tasksFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const result = { tasksFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };

    logger.info("Running overdue task automation check...");

    try {
      const overdueTasks = await database
        .select({
          id: tasks.id,
          title: tasks.title,
          endDate: tasks.endDate,
          assignedTo: tasks.assignedTo,
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
            or(
              isNull(tasks.overdueNotifiedAt),
              lt(
                tasks.overdueNotifiedAt,
                sql`now() - interval '${sql.raw(String(OVERDUE_REMINDER_INTERVAL_DAYS))} days'`,
              ),
            ),
          ),
        );

      result.tasksFound = overdueTasks.length;
      logger.info(`Overdue task automation: found ${overdueTasks.length} tasks to process`, {
        taskIds: overdueTasks.map((t) => t.id),
        taskTitles: overdueTasks.map((t) => t.title),
      });

      if (overdueTasks.length === 0) {
        logger.info("Overdue task automation: no tasks to process — either all notified already or none are overdue");
        return result;
      }

      const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";

      for (const task of overdueTasks) {
        logger.info(`Processing overdue task: "${task.title}" (id=${task.id}, endDate=${task.endDate})`);

        // 1. Mark status as 'delay' — always correct regardless of email outcome
        await database
          .update(tasks)
          .set({ status: "delay", updatedAt: now })
          .where(eq(tasks.id, task.id));

        const endDateFormatted = task.endDate
          ? new Date(task.endDate).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "Unknown";
        const taskUrl = `${frontendUrl}/projects/${task.projectId}/tasks/${task.id}`;

        // 2. Collect recipients: assignee + project manager (deduplicated)
        const directRecipientIds = Array.from(
          new Set(
            [task.assignedTo, task.projectManagerId].filter(Boolean) as string[],
          ),
        );

        // If no direct recipients, fall back to the organization owner
        let isOwnerFallback = false;
        let recipientIds = directRecipientIds;

        if (recipientIds.length === 0) {
          logger.info(`Task "${task.title}" has no assignee or project manager — falling back to org owner`);
          const owner = await this.getOrgOwnerUser(task.organizationId ?? "");
          if (!owner) {
            const msg = `Task "${task.title}" (${task.id}): no assignee, no project manager, and no org owner found — skipping`;
            logger.error(msg);
            result.errors.push(msg);
            // Mark as notified to avoid infinite retry on a genuinely ownerless org
            await database
              .update(tasks)
              .set({ overdueNotifiedAt: now })
              .where(eq(tasks.id, task.id));
            continue;
          }
          recipientIds = [owner.id];
          isOwnerFallback = true;
        }

        logger.info(`Task "${task.title}": recipients=${JSON.stringify(recipientIds)}, ownerFallback=${isOwnerFallback}`);

        let emailSentForThisTask = false;

        for (const userId of recipientIds) {
          const userRows = await database
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

          const user = userRows[0];
          if (!user?.email) {
            const msg = `User ${userId} not found or has no email — skipping`;
            logger.warn(msg);
            result.errors.push(msg);
            continue;
          }

          logger.info(`Sending overdue email for task "${task.title}" to ${user.email}${isOwnerFallback ? " [owner fallback]" : ""}`);

          // 3. In-app notification (always, independent of email)
          await this.createNotification({
            userId: user.id,
            organizationId: task.organizationId,
            type: "task_overdue",
            title: "Task Overdue",
            message: isOwnerFallback
              ? `Task "${task.title}" in project "${task.projectName}" is overdue and has no assigned user.`
              : `Task "${task.title}" in project "${task.projectName}" is overdue.`,
            data: { taskId: task.id, projectId: task.projectId },
          });

          // 4. Transactional email
          const emailResult: EmailResult = await sendTransactionalEmail({
            to: user.email,
            toName: user.name ?? undefined,
            templateKey: "task_overdue",
            data: {
              assigneeName: user.name ?? user.email,
              taskTitle: task.title,
              projectName: task.projectName ?? "Unknown project",
              endDate: endDateFormatted,
              taskUrl,
              fallbackNote: isOwnerFallback
                ? "This task has no assigned user. You're being notified as the organization owner."
                : undefined,
            },
          });

          if (emailResult.success) {
            result.emailsSent++;
            emailSentForThisTask = true;
          } else {
            result.emailsFailed++;
            result.errors.push(`Email to ${user.email} failed: ${emailResult.error}`);
          }
        }

        // 5. Only stamp overdueNotifiedAt if at least one email was delivered.
        //    If all failed, task stays eligible for the next cron run.
        if (emailSentForThisTask) {
          await database
            .update(tasks)
            .set({ overdueNotifiedAt: now })
            .where(eq(tasks.id, task.id));
          logger.info(`Task "${task.title}" marked as notified (overdueNotifiedAt set)`);
        } else {
          logger.warn(`Task "${task.title}" (${task.id}): all emails failed — overdueNotifiedAt NOT set, will retry next run`);
        }
      }

      logger.info("Overdue task automation completed", result);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      logger.error("Error in overdue task automation:", error);
      result.errors.push(`Automation error: ${msg}`);
    }

    return result;
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
