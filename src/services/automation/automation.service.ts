import { database } from "../../configs/connection.config";
import { tasks, projects, notifications, users, userOrganizations, organizations, projectRiskAlerts, clients, invoices, paymentLinks, leadWebhooks, leadWebhookLogs, supportTickets, supportTicketMessages, automationSettings } from "../../schema/schema";
import { eq, and, lt, ne, sql, gte, count, isNull, or, inArray, not, desc } from "drizzle-orm";
import { logger } from "../../utils/logger.util";
import { computeHighRiskProjects } from "../projectRisk.service";
import {
  computeProjectStatus,
  isAutoManagedProjectStatus,
  ProjectStatus,
} from "../projectStatus.service";
import { checkOrgHasWeeklyActivity, generateWeeklySummary } from "../weeklySummary.service";

// How often to re-send overdue reminders for tasks that remain unresolved.
// Future: make this configurable per organization.
const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

// How often to re-alert on a project that remains at high risk.
// Future: make this configurable per organization.
const PROJECT_RISK_ALERT_INTERVAL_DAYS = 7;
import { sendTransactionalEmail, EmailResult } from "../email/transactional.service";
import { sendPushToUser } from "../../utils/web-push.util";
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
   * Recalculates a project's status from its tasks (computeProjectStatus)
   * and persists it if it changed. No-ops if the project's current status
   * isn't one of the 4 auto-managed values (pending/ongoing/delayed/completed)
   * — a manually-set status like "on-hold" is left untouched.
   */
  async recalculateProjectStatus(
    projectId: string,
  ): Promise<ProjectStatus | null> {
    try {
      return await database.transaction(async (tx) => {
        const projectRows = await tx
          .select({ id: projects.id, status: projects.status })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1);

        const project = projectRows[0];
        if (!project) return null;

        if (!isAutoManagedProjectStatus(project.status)) {
          logger.info(
            `Project ${projectId}: status "${project.status}" is not auto-managed — skipping status recalculation`,
          );
          return null;
        }

        const projectTasks = await tx
          .select({ status: tasks.status, endDate: tasks.endDate })
          .from(tasks)
          .where(eq(tasks.projectId, projectId));

        const computedStatus = computeProjectStatus(projectTasks);

        if (computedStatus !== project.status) {
          await tx
            .update(projects)
            .set({ status: computedStatus, updatedAt: new Date() })
            .where(eq(projects.id, projectId));
          logger.info(
            `Project ${projectId}: status auto-updated "${project.status}" -> "${computedStatus}"`,
          );
        }

        return computedStatus;
      });
    } catch (error) {
      logger.error(`Error recalculating status for project ${projectId}:`, error);
      return null;
    }
  }

  /**
   * Marks overdue tasks as 'delay', creates in-app notifications, and sends
   * a one-time email to the assignee and the project manager.
   * Runs daily via cron. Returns a result object for observability.
   */
  async handleOverdueTasks(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    tasksFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const result = { tasksFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const excludedOrgs = await this.getExcludedOrgIds("task-overdue", opts?.scheduleFilter);
    const touchedProjectIds = new Set<string>();

    logger.info("Running overdue task automation check...");

    try {
      const orgFilter = opts?.organizationId ? eq(projects.organizationId, opts.organizationId) : undefined;
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
            opts?.forceRun ? undefined : or(
              isNull(tasks.overdueNotifiedAt),
              lt(
                tasks.overdueNotifiedAt,
                sql`now() - interval '${sql.raw(String(OVERDUE_REMINDER_INTERVAL_DAYS))} days'`,
              ),
            ),
            orgFilter,
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
        if (task.organizationId && excludedOrgs.has(task.organizationId)) continue;
        logger.info(`Processing overdue task: "${task.title}" (id=${task.id}, endDate=${task.endDate})`);

        // 1. Mark status as 'delay' — always correct regardless of email outcome
        await database
          .update(tasks)
          .set({ status: "delay", updatedAt: now })
          .where(eq(tasks.id, task.id));

        if (task.projectId) touchedProjectIds.add(task.projectId);

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
          const canEmail = await this.userEmailEnabled(user.id, "projectActivityUpdates");
          if (canEmail) {
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

      // Tasks just flipped to 'delay' (or were already overdue before this
      // run) can push their project into "delayed" even if every other task
      // is completed — recalculate once per touched project.
      for (const projectId of touchedProjectIds) {
        await this.recalculateProjectStatus(projectId).catch((err) => {
          logger.error(`Failed to recalculate status for project ${projectId}:`, err);
        });
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
   * Detects high-risk projects across all organizations, persists alerts,
   * sends email notifications, and auto-resolves projects that are no longer at risk.
   * Runs daily via cron.
   */
  async handleProjectRiskAlerts(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    projectsFound: number;
    alertsCreated: number;
    alertsResolved: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const result = {
      projectsFound: 0,
      alertsCreated: 0,
      alertsResolved: 0,
      emailsSent: 0,
      emailsFailed: 0,
      errors: [] as string[],
    };
    const excludedOrgs = await this.getExcludedOrgIds("project-risk", opts?.scheduleFilter);

    logger.info("Running project risk alert automation...");

    try {
      const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";

      // Fetch organizations (scoped to one org when organizationId is provided)
      const allOrgs = opts?.organizationId
        ? [{ id: opts.organizationId }]
        : await database.select({ id: organizations.id }).from(organizations);

      logger.info(`Project risk automation: found ${allOrgs.length} org(s) to evaluate`);

      for (const org of allOrgs) {
        if (excludedOrgs.has(org.id)) continue;
        const highRiskProjects = await computeHighRiskProjects(org.id);

        logger.info(
          `Org ${org.id}: ${highRiskProjects.length} high-risk project(s) — ` +
            (highRiskProjects.length > 0
              ? highRiskProjects
                  .map(
                    (p) =>
                      `"${p.projectName}" riskScore=${p.riskScore} delayRisk=${p.delayRisk} budgetRisk=${p.budgetRisk}`,
                  )
                  .join("; ")
              : "none"),
        );

        result.projectsFound += highRiskProjects.length;

        const highRiskProjectIds = highRiskProjects.map((p) => p.projectId);

        // Auto-resolve alerts for projects no longer at high risk
        if (highRiskProjectIds.length > 0) {
          await database
            .update(projectRiskAlerts)
            .set({ status: "resolved", updatedAt: now })
            .where(
              and(
                eq(projectRiskAlerts.organizationId, org.id),
                eq(projectRiskAlerts.status, "active"),
                not(inArray(projectRiskAlerts.projectId, highRiskProjectIds)),
              ),
            );
        } else {
          // All active alerts for this org can be resolved
          const resolved = await database
            .update(projectRiskAlerts)
            .set({ status: "resolved", updatedAt: now })
            .where(
              and(
                eq(projectRiskAlerts.organizationId, org.id),
                eq(projectRiskAlerts.status, "active"),
              ),
            )
            .returning({ id: projectRiskAlerts.id });
          result.alertsResolved += resolved.length;
          continue;
        }

        for (const project of highRiskProjects) {
          // Check if eligible: no active alert, OR nextEligibleAt has passed
          const existingAlert = await database
            .select({
              id: projectRiskAlerts.id,
              nextEligibleAt: projectRiskAlerts.nextEligibleAt,
            })
            .from(projectRiskAlerts)
            .where(
              and(
                eq(projectRiskAlerts.projectId, project.projectId),
                eq(projectRiskAlerts.status, "active"),
              ),
            )
            .limit(1);

          if (existingAlert.length > 0) {
            const eligible = existingAlert[0].nextEligibleAt;
            if (!opts?.forceRun && (!eligible || eligible > now)) {
              logger.info(`Project "${project.projectName}": active alert exists and not yet eligible for re-alert — skipping`);
              continue;
            }
          }

          // Resolve old active alert before creating a new one
          if (existingAlert.length > 0) {
            await database
              .update(projectRiskAlerts)
              .set({ status: "resolved", updatedAt: now })
              .where(eq(projectRiskAlerts.id, existingAlert[0].id));
            result.alertsResolved++;
          }

          // Determine recipient: project manager → org owner fallback
          const recipientUserId = project.assignedTo;
          let recipient: { id: string; name: string | null; email: string } | null = null;

          if (recipientUserId) {
            const rows = await database
              .select({ id: users.id, name: users.name, email: users.email })
              .from(users)
              .where(eq(users.id, recipientUserId))
              .limit(1);
            recipient = rows[0] ?? null;
          }

          if (!recipient) {
            recipient = await this.getOrgOwnerUser(org.id);
          }

          if (!recipient) {
            const msg = `Project "${project.projectName}" (${project.projectId}): no project manager and no org owner found — skipping`;
            logger.error(msg);
            result.errors.push(msg);
            continue;
          }

          // Send email first — only persist alert on success
          const projectUrl = `${frontendUrl}/projects/${project.projectId}`;
          const canEmail = await this.userEmailEnabled(recipient.id, "projectActivityUpdates");
          if (canEmail) {
            const emailResult = await sendTransactionalEmail({
              to: recipient.email,
              toName: recipient.name ?? undefined,
              templateKey: "project_risk",
              data: {
                recipientName: recipient.name ?? recipient.email,
                projectName: project.projectName,
                projectNumber: project.projectNumber,
                riskScore: project.riskScore,
                reasons: project.reasons,
                projectUrl,
              },
            });

            if (emailResult.success) {
              result.emailsSent++;

              const nextEligibleAt = new Date(
                now.getTime() + PROJECT_RISK_ALERT_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
              );

              await database.insert(projectRiskAlerts).values({
                projectId: project.projectId,
                organizationId: org.id,
                riskScore: project.riskScore,
                delayRisk: project.delayRisk,
                budgetRisk: project.budgetRisk,
                reasons: project.reasons,
                overdueTaskTitles: project.overdueTaskTitles,
                status: "active",
                nextEligibleAt,
              });
              result.alertsCreated++;

              // In-app notification for the recipient
              await this.createNotification({
                userId: recipient.id,
                organizationId: org.id,
                type: "project_risk",
                title: "Project at Risk",
                message: `Project "${project.projectName}" has a risk score of ${project.riskScore}/100.`,
                data: { projectId: project.projectId },
              });
            } else {
              result.emailsFailed++;
              result.errors.push(
                `Email to ${recipient.email} for project "${project.projectName}" failed: ${emailResult.error}`,
              );
            }
          }
        }
      }

      logger.info("Project risk alert automation completed", result);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      logger.error("Error in project risk alert automation:", error);
      result.errors.push(`Automation error: ${msg}`);
    }

    return result;
  }

  /**
   * Finds leads whose follow-up date has passed and sends an email reminder.
   * Re-alerts every 7 days while the follow-up remains overdue.
   */
  async handleLeadFollowUpOverdue(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    leadsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const result = { leadsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const excludedOrgs = await this.getExcludedOrgIds("lead-followup", opts?.scheduleFilter);

    logger.info("Running lead follow-up overdue automation...");

    try {
      const orgFilter = opts?.organizationId ? eq(clients.organizationId, opts.organizationId) : undefined;
      const overdueLeads = await database
        .select({
          id: clients.id,
          name: clients.name,
          email: clients.email,
          organizationId: clients.organizationId,
          assignedTo: clients.assignedTo,
          followUpAt: clients.followUpAt,
          businessIndustry: clients.businessIndustry,
          followupNotifiedAt: clients.followupNotifiedAt,
        })
        .from(clients)
        .where(
          and(
            eq(clients.clientType, "lead"),
            lt(clients.followUpAt, now),
            not(inArray(clients.status, ["Lost", "Completed", "Inactive"])),
            opts?.forceRun ? undefined : or(
              isNull(clients.followupNotifiedAt),
              lt(clients.followupNotifiedAt, sevenDaysAgo),
            ),
            orgFilter,
          ),
        );

      result.leadsFound = overdueLeads.length;
      logger.info(`Lead follow-up automation: ${overdueLeads.length} overdue lead(s) found`);

      for (const lead of overdueLeads) {
        if (excludedOrgs.has(lead.organizationId)) continue;
        let recipient: { id: string; name: string | null; email: string } | null = null;

        if (lead.assignedTo) {
          const rows = await database
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, lead.assignedTo))
            .limit(1);
          recipient = rows[0] ?? null;
        }

        if (!recipient) {
          recipient = await this.getOrgOwnerUser(lead.organizationId);
        }

        if (!recipient) {
          const msg = `Lead "${lead.name}" (${lead.id}): no assignee and no org owner found — skipping`;
          logger.error(msg);
          result.errors.push(msg);
          continue;
        }

        const followUpLabel = lead.followUpAt
          ? new Date(lead.followUpAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })
          : "unknown date";

        const leadUrl = `${frontendUrl}/leads/${lead.id}`;

        const noteSuffix = (lead as any).followUpNote ? ` — ${(lead as any).followUpNote}` : "";
        // In-app notification — independent of email outcome
        await this.createNotification({
          userId: recipient.id,
          organizationId: lead.organizationId,
          type: "lead_followup_overdue",
          title: "Lead Follow-up Overdue",
          message: `Follow-up for "${lead.name}" was due on ${followUpLabel}.${noteSuffix}`,
          data: { leadId: lead.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "projectActivityUpdates");
        if (!canEmail) {
          // In-app already sent above; stamp so we don't re-alert on next cron run
          await database.update(clients).set({ followupNotifiedAt: now }).where(eq(clients.id, lead.id));
          continue;
        }

        const emailResult = await sendTransactionalEmail({
          to: recipient.email,
          toName: recipient.name ?? recipient.email,
          templateKey: "lead_follow_up",
          data: {
            recipientName: recipient.name ?? recipient.email,
            leadName: lead.name,
            followUpAt: followUpLabel,
            businessIndustry: lead.businessIndustry ?? null,
            leadUrl,
          },
        });

        if (emailResult.success) {
          result.emailsSent++;
          await database
            .update(clients)
            .set({ followupNotifiedAt: now })
            .where(eq(clients.id, lead.id));
        } else {
          result.emailsFailed++;
          result.errors.push(
            `Email to ${recipient.email} for lead "${lead.name}" failed: ${emailResult.error}`,
          );
        }
      }

      logger.info("Lead follow-up overdue automation completed", result);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      logger.error("Error in lead follow-up automation:", error);
      result.errors.push(`Automation error: ${msg}`);
    }

    return result;
  }

  /**
   * Sends a weekly summary email to org owners for every organization that had
   * activity during the past 7 days. Powered by the same OpenAI call as the
   * on-demand /ai/weekly-summary endpoint.
   */
  async handleWeeklySummary(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string }): Promise<{
    organizationsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { organizationsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const excludedOrgs = await this.getExcludedOrgIds("weekly-summary", opts?.scheduleFilter);

    const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    logger.info(`Running weekly summary automation for week ${weekLabel}...`);

    try {
      const allOrgs = opts?.organizationId
        ? await database.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, opts.organizationId))
        : await database.select({ id: organizations.id, name: organizations.name }).from(organizations);

      for (const org of allOrgs) {
        if (excludedOrgs.has(org.id)) continue;
        const hasActivity = await checkOrgHasWeeklyActivity(org.id, weekStart, now);
        if (!hasActivity) {
          logger.info(`Org ${org.id} ("${org.name}"): no activity this week, skipping`);
          continue;
        }

        result.organizationsFound++;

        const summary = await generateWeeklySummary(org.id, weekStart, now, org.name);
        if (!summary) {
          const msg = `Org ${org.id} ("${org.name}"): failed to generate weekly summary (OpenAI unavailable or no projects)`;
          logger.warn(msg);
          result.errors.push(msg);
          continue;
        }

        // Skip if all metrics are zero — nothing meaningful to report
        const hasContent =
          summary.metrics.completedTasks > 0 ||
          summary.metrics.totalHours > 0 ||
          summary.highlights.length > 0;
        if (!hasContent) {
          logger.info(`Org ${org.id} ("${org.name}"): metrics all zero, skipping email`);
          continue;
        }

        // Send to all owners of this org (not just one)
        const ownerRows = await database
          .select({ id: users.id, name: users.name, email: users.email })
          .from(userOrganizations)
          .innerJoin(users, eq(userOrganizations.userId, users.id))
          .where(
            and(
              eq(userOrganizations.organizationId, org.id),
              inArray(userOrganizations.role, ["org", "owner", "admin"]),
            ),
          );

        if (ownerRows.length === 0) {
          // Fallback: any member
          const fallback = await this.getOrgOwnerUser(org.id);
          if (fallback) ownerRows.push(fallback as typeof ownerRows[0]);
        }

        for (const owner of ownerRows) {
          // In-app notification — independent of email outcome
          await this.createNotification({
            userId: owner.id,
            organizationId: org.id,
            type: "weekly_summary",
            title: `Weekly Summary: ${weekLabel}`,
            message: `Your weekly summary for ${org.name} is ready. ${summary.metrics.completedTasks} task(s) completed, ${summary.metrics.totalHours.toFixed(1)}h logged.`,
            data: {},
          });

          const emailResult = await sendTransactionalEmail({
            to: owner.email,
            toName: owner.name ?? owner.email,
            templateKey: "weekly_summary",
            data: {
              recipientName: owner.name ?? owner.email,
              organizationName: org.name,
              weekLabel,
              summaryText: summary.summary,
              highlights: summary.highlights,
              metrics: {
                activeProjects: summary.metrics.activeProjects,
                completedTasks: summary.metrics.completedTasks,
                totalHours: summary.metrics.totalHours,
                billableHours: summary.metrics.billableHours,
              },
              projectBreakdown: summary.projectBreakdown.map((p) => ({
                projectName: p.projectName,
                projectNumber: p.projectNumber,
                progress: p.progress,
                tasksCompleted: p.tasksCompleted,
                tasksInProgress: p.tasksInProgress,
                tasksPending: p.tasksPending,
                hoursSpent: p.hoursSpent,
              })),
              recommendations: summary.recommendations,
            },
          });

          if (emailResult.success) {
            result.emailsSent++;
          } else {
            result.emailsFailed++;
            result.errors.push(
              `Weekly summary email to ${owner.email} (org "${org.name}") failed: ${emailResult.error}`,
            );
          }
        }
      }

      logger.info("Weekly summary automation completed", result);
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      logger.error("Error in weekly summary automation:", error);
      result.errors.push(`Automation error: ${msg}`);
    }

    return result;
  }

  // A3: returns true if this automation is enabled for the org (default: true when no row exists)
  async isAutomationEnabled(organizationId: string, automationKey: string): Promise<boolean> {
    const rows = await database
      .select({ enabled: automationSettings.enabled })
      .from(automationSettings)
      .where(and(eq(automationSettings.organizationId, organizationId), eq(automationSettings.automationKey, automationKey)))
      .limit(1);
    return rows.length === 0 || rows[0].enabled;
  }

  // A3: returns set of org IDs to skip — disabled orgs, plus (when scheduleFilter is provided)
  // orgs whose custom schedule hour doesn't match currentHour.
  // Orgs with no settings row use the system defaultHour when scheduleFilter is active.
  private async getExcludedOrgIds(
    automationKey: string,
    scheduleFilter?: { currentHour: number; defaultHour: number },
  ): Promise<Set<string>> {
    if (!scheduleFilter) {
      const rows = await database
        .select({ organizationId: automationSettings.organizationId })
        .from(automationSettings)
        .where(and(eq(automationSettings.automationKey, automationKey), eq(automationSettings.enabled, false)));
      return new Set(rows.map((r) => r.organizationId));
    }

    const { currentHour, defaultHour } = scheduleFilter;
    const settingsRows = await database
      .select({
        organizationId: automationSettings.organizationId,
        enabled: automationSettings.enabled,
        scheduleHourUtc: automationSettings.scheduleHourUtc,
      })
      .from(automationSettings)
      .where(eq(automationSettings.automationKey, automationKey));

    const settingsMap = new Map(settingsRows.map((r) => [r.organizationId, r]));

    const allOrgs = await database
      .select({ id: organizations.id })
      .from(organizations)
      .where(ne(organizations.status, "inactive"));

    const excluded = new Set<string>();
    for (const org of allOrgs) {
      const s = settingsMap.get(org.id);
      if (s && !s.enabled) { excluded.add(org.id); continue; }
      const customHour = s?.scheduleHourUtc ?? null;
      if (customHour !== null ? customHour !== currentHour : currentHour !== defaultHour) {
        excluded.add(org.id);
      }
    }
    return excluded;
  }

  // A4: check if email should be sent to this user for this pref key
  private async userEmailEnabled(userId: string, prefKey: "paymentAlerts" | "invoiceReminders" | "projectActivityUpdates" | "emailNotifications"): Promise<boolean> {
    const rows = await database
      .select({ notificationPreferences: users.notificationPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const prefs = rows[0]?.notificationPreferences;
    if (!prefs) return true;
    if (prefs.emailNotifications === false) return false;
    return prefs[prefKey] !== false;
  }

  // ==================== NEW AUTOMATIONS ====================

  async handleInvoiceOverdue(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    invoicesFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { invoicesFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("invoice-overdue", opts?.scheduleFilter);

    try {
      const overdueInvoices = await database
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          clientname: invoices.clientname,
          amount: invoices.amount,
          dueDate: invoices.dueDate,
          organizationId: invoices.organizationId,
          overdueNotifiedAt: invoices.overdueNotifiedAt,
        })
        .from(invoices)
        .where(
          and(
            ne(invoices.status, "paid"),
            ne(invoices.status, "cancelled"),
            lt(invoices.dueDate, now),
            opts?.forceRun ? undefined : or(isNull(invoices.overdueNotifiedAt), lt(invoices.overdueNotifiedAt, sevenDaysAgo)),
            opts?.organizationId ? eq(invoices.organizationId, opts.organizationId) : undefined,
          ),
        );

      result.invoicesFound = overdueInvoices.length;

      for (const invoice of overdueInvoices) {
        if (disabledOrgs.has(invoice.organizationId)) continue;

        const recipient = await this.getOrgOwnerUser(invoice.organizationId);
        if (!recipient) { result.errors.push(`Invoice ${invoice.id}: no org owner`); continue; }

        const dueDateStr = invoice.dueDate
          ? new Date(invoice.dueDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
          : "unknown";
        const invoiceUrl = `${frontendUrl}/dashboard/invoices/${invoice.id}`;

        await this.createNotification({
          userId: recipient.id,
          organizationId: invoice.organizationId,
          type: "invoice_overdue",
          title: "Invoice Overdue",
          message: `Invoice ${invoice.invoiceNumber} for ${invoice.clientname} of $${invoice.amount} is overdue since ${dueDateStr}.`,
          data: { invoiceId: invoice.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "invoiceReminders");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "invoice_overdue",
            data: {
              recipientName: recipient.name ?? recipient.email,
              invoiceNumber: invoice.invoiceNumber,
              clientname: invoice.clientname,
              amount: `$${invoice.amount}`,
              dueDate: dueDateStr,
              invoiceUrl,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }

        await database
          .update(invoices)
          .set({ overdueNotifiedAt: now, updatedAt: now })
          .where(eq(invoices.id, invoice.id));
      }
      logger.info("Invoice overdue automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in invoice overdue automation:", error);
    }
    return result;
  }

  async handlePaymentLinkReminder(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    linksFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { linksFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const disabledOrgs = await this.getExcludedOrgIds("payment-link-reminder", opts?.scheduleFilter);

    try {
      const unpaidLinks = await database
        .select({
          id: paymentLinks.id,
          clientname: paymentLinks.clientname,
          amount: paymentLinks.amount,
          organizationId: paymentLinks.organizationId,
          createdAt: paymentLinks.createdAt,
          reminderNotifiedAt: paymentLinks.reminderNotifiedAt,
          paymentLink: paymentLinks.paymentLink,
        })
        .from(paymentLinks)
        .where(
          and(
            eq(paymentLinks.status, "unpaid"),
            lt(paymentLinks.createdAt, sevenDaysAgo),
            opts?.forceRun ? undefined : or(isNull(paymentLinks.reminderNotifiedAt), lt(paymentLinks.reminderNotifiedAt, sevenDaysAgo)),
            opts?.organizationId ? eq(paymentLinks.organizationId, opts.organizationId) : undefined,
          ),
        );

      result.linksFound = unpaidLinks.length;

      for (const link of unpaidLinks) {
        if (disabledOrgs.has(link.organizationId)) continue;

        const recipient = await this.getOrgOwnerUser(link.organizationId);
        if (!recipient) { result.errors.push(`Payment link ${link.id}: no org owner`); continue; }

        const createdStr = new Date(link.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

        await this.createNotification({
          userId: recipient.id,
          organizationId: link.organizationId,
          type: "payment_link_reminder",
          title: "Payment Link Reminder",
          message: `Payment link for ${link.clientname} ($${link.amount}) created on ${createdStr} is still unpaid.`,
          data: { paymentLinkId: link.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "paymentAlerts");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "payment_link_reminder",
            data: {
              recipientName: recipient.name ?? recipient.email,
              clientname: link.clientname,
              amount: `$${link.amount}`,
              createdAt: createdStr,
              paymentUrl: link.paymentLink ?? undefined,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }

        await database
          .update(paymentLinks)
          .set({ reminderNotifiedAt: now, updatedAt: now })
          .where(eq(paymentLinks.id, link.id));
      }
      logger.info("Payment link reminder automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in payment link reminder automation:", error);
    }
    return result;
  }

  async handleWebhookIssue(opts?: { organizationId?: string }): Promise<{
    webhooksFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { webhooksFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("webhook-issue");

    try {
      const activeWebhooks = await database
        .select({
          id: leadWebhooks.id,
          name: leadWebhooks.name,
          orgId: leadWebhooks.orgId,
          createdAt: leadWebhooks.createdAt,
        })
        .from(leadWebhooks)
        .where(
          and(
            eq(leadWebhooks.active, true),
            opts?.organizationId ? eq(leadWebhooks.orgId, opts.organizationId) : undefined,
          ),
        );

      for (const wh of activeWebhooks) {
        if (disabledOrgs.has(wh.orgId)) continue;

        // Last 10 logs
        const recentLogs = await database
          .select({ status: leadWebhookLogs.status, createdAt: leadWebhookLogs.createdAt })
          .from(leadWebhookLogs)
          .where(eq(leadWebhookLogs.webhookId, wh.id))
          .orderBy(desc(leadWebhookLogs.createdAt))
          .limit(10);

        let issueType: "silent" | "failing" | null = null;
        let details = "";

        if (recentLogs.length === 0) {
          // No logs at all and webhook is at least 7 days old
          if (new Date(wh.createdAt) < sevenDaysAgo) {
            issueType = "silent";
            details = "No webhook calls received in the past 7 days";
          }
        } else {
          // Check if most recent call was >7 days ago
          const lastCallAt = new Date(recentLogs[0].createdAt);
          if (lastCallAt < sevenDaysAgo) {
            issueType = "silent";
            details = `Last call was on ${lastCallAt.toLocaleDateString("en-US")}`;
          } else {
            // Check error rate in last 10 calls
            const errorCount = recentLogs.filter((l) =>
              l.status === "error" || l.status === "permanently_failed"
            ).length;
            if (errorCount / recentLogs.length > 0.5) {
              issueType = "failing";
              details = `${errorCount} of last ${recentLogs.length} calls failed`;
            }
          }
        }

        if (!issueType) continue;
        result.webhooksFound++;

        const recipient = await this.getOrgOwnerUser(wh.orgId);
        if (!recipient) { result.errors.push(`Webhook ${wh.id}: no org owner`); continue; }

        await this.createNotification({
          userId: recipient.id,
          organizationId: wh.orgId,
          type: "webhook_issue",
          title: issueType === "silent" ? "Webhook Silent" : "Webhook Failing",
          message: `Webhook "${wh.name}": ${details}.`,
          data: { webhookId: wh.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "webhook_issue",
            data: {
              recipientName: recipient.name ?? recipient.email,
              webhookName: wh.name,
              issueType,
              details,
              webhooksUrl: `${frontendUrl}/dashboard/integrations/webhooks`,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }
      }
      logger.info("Webhook issue automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in webhook issue automation:", error);
    }
    return result;
  }

  async handleNewLeadNotContacted(opts?: { organizationId?: string; forceRun?: boolean }): Promise<{
    leadsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const result = { leadsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("new-lead-not-contacted");

    try {
      const newLeads = await database
        .select({
          id: clients.id,
          name: clients.name,
          organizationId: clients.organizationId,
          assignedTo: clients.assignedTo,
          createdAt: clients.createdAt,
        })
        .from(clients)
        .where(
          and(
            eq(clients.clientType, "lead"),
            eq(clients.status, "New Lead"),
            lt(clients.createdAt, twentyFourHoursAgo),
            opts?.organizationId ? eq(clients.organizationId, opts.organizationId) : undefined,
          ),
        );

      for (const lead of newLeads) {
        if (disabledOrgs.has(lead.organizationId)) continue;

        // Skip if already notified recently (check notifications table)
        const recentNotif = opts?.forceRun ? [] : await database
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, lead.organizationId),
              eq(notifications.type, "lead_not_contacted"),
              sql`${notifications.data}->>'leadId' = ${lead.id}`,
              gte(notifications.createdAt, twentyFourHoursAgo),
            ),
          )
          .limit(1);
        if (recentNotif.length > 0) continue;

        result.leadsFound++;

        let recipient: { id: string; name: string | null; email: string } | null = null;
        if (lead.assignedTo) {
          const rows = await database.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, lead.assignedTo)).limit(1);
          recipient = rows[0] ?? null;
        }
        if (!recipient) recipient = await this.getOrgOwnerUser(lead.organizationId);
        if (!recipient) { result.errors.push(`Lead ${lead.id}: no recipient`); continue; }

        const hoursAgo = Math.floor((now.getTime() - new Date(lead.createdAt).getTime()) / 3_600_000);

        await this.createNotification({
          userId: recipient.id,
          organizationId: lead.organizationId,
          type: "lead_not_contacted",
          title: "New Lead Not Contacted",
          message: `Lead "${lead.name}" was created ${hoursAgo}h ago with no interactions.`,
          data: { leadId: lead.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "new_lead_not_contacted",
            data: {
              recipientName: recipient.name ?? recipient.email,
              leadName: lead.name,
              hoursAgo,
              leadUrl: `${frontendUrl}/dashboard/leads/${lead.id}`,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }
      }
      logger.info("New lead not contacted automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in new-lead-not-contacted automation:", error);
    }
    return result;
  }

  async handleClientInactivity(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    clientsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { clientsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("client-inactivity", opts?.scheduleFilter);

    try {
      const allClients = await database
        .select({
          id: clients.id,
          name: clients.name,
          organizationId: clients.organizationId,
        })
        .from(clients)
        .where(
          and(
            eq(clients.clientType, "client"),
            opts?.organizationId ? eq(clients.organizationId, opts.organizationId) : undefined,
          ),
        );

      for (const client of allClients) {
        if (disabledOrgs.has(client.organizationId)) continue;

        // Check active projects in last 30 days
        const [activeProjects] = await database
          .select({ c: count() })
          .from(projects)
          .where(
            and(
              eq(projects.clientId, client.id),
              ne(projects.status, "completed"),
              gte(projects.updatedAt, thirtyDaysAgo),
            ),
          );
        if ((activeProjects?.c ?? 0) > 0) continue;

        // Check notification guard — already notified in last 7 days?
        const recentNotif = opts?.forceRun ? [] : await database
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, client.organizationId),
              eq(notifications.type, "client_inactive"),
              sql`${notifications.data}->>'clientId' = ${client.id}`,
              gte(notifications.createdAt, sevenDaysAgo),
            ),
          )
          .limit(1);
        if (recentNotif.length > 0) continue;

        result.clientsFound++;

        const recipient = await this.getOrgOwnerUser(client.organizationId);
        if (!recipient) { result.errors.push(`Client ${client.id}: no org owner`); continue; }

        await this.createNotification({
          userId: recipient.id,
          organizationId: client.organizationId,
          type: "client_inactive",
          title: "Client Inactivity",
          message: `Client "${client.name}" has no active projects or tasks in the last 30 days.`,
          data: { clientId: client.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "client_inactivity",
            data: {
              recipientName: recipient.name ?? recipient.email,
              clientName: client.name,
              daysSinceActivity: 30,
              clientUrl: `${frontendUrl}/dashboard/clients/${client.id}`,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }
      }
      logger.info("Client inactivity automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in client inactivity automation:", error);
    }
    return result;
  }

  async handleSupportTicketUnanswered(opts?: { organizationId?: string; forceRun?: boolean }): Promise<{
    ticketsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const result = { ticketsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("support-ticket-unanswered");

    try {
      const openTickets = await database
        .select({
          id: supportTickets.id,
          ticketNumber: supportTickets.ticketNumber,
          subject: supportTickets.subject,
          submittedby: supportTickets.submittedby,
          createdon: supportTickets.createdon,
        })
        .from(supportTickets)
        .where(
          and(
            eq(supportTickets.status, "open"),
            lt(supportTickets.createdon, twentyFourHoursAgo),
          ),
        );

      for (const ticket of openTickets) {
        // Check if any response message exists (besides submitter's initial message)
        const [responseCount] = await database
          .select({ c: count() })
          .from(supportTicketMessages)
          .where(
            and(
              eq(supportTicketMessages.ticketId, ticket.id),
              ne(supportTicketMessages.senderId, ticket.submittedby),
            ),
          );
        if ((responseCount?.c ?? 0) > 0) continue;

        // Resolve submitter's org to notify the owner
        const orgRows = await database
          .select({ organizationId: userOrganizations.organizationId })
          .from(userOrganizations)
          .where(eq(userOrganizations.userId, ticket.submittedby))
          .limit(1);
        const orgId = orgRows[0]?.organizationId;
        if (!orgId || disabledOrgs.has(orgId)) continue;
        if (opts?.organizationId && orgId !== opts.organizationId) continue;

        // 24h guard via notifications table
        const recentNotif = opts?.forceRun ? [] : await database
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.organizationId, orgId),
              eq(notifications.type, "support_ticket_unanswered"),
              sql`${notifications.data}->>'ticketId' = ${ticket.id}`,
              gte(notifications.createdAt, twentyFourHoursAgo),
            ),
          )
          .limit(1);
        if (recentNotif.length > 0) continue;

        result.ticketsFound++;

        const recipient = await this.getOrgOwnerUser(orgId);
        if (!recipient) { result.errors.push(`Ticket ${ticket.id}: no org owner`); continue; }

        const hoursOpen = Math.floor((now.getTime() - new Date(ticket.createdon).getTime()) / 3_600_000);

        await this.createNotification({
          userId: recipient.id,
          organizationId: orgId,
          type: "support_ticket_unanswered",
          title: "Support Ticket Unanswered",
          message: `Ticket #${ticket.ticketNumber} "${ticket.subject}" has been open ${hoursOpen}h with no response.`,
          data: { ticketId: ticket.id },
        });

        const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
        if (canEmail) {
          const emailResult = await sendTransactionalEmail({
            to: recipient.email,
            toName: recipient.name ?? undefined,
            templateKey: "support_ticket_unanswered",
            data: {
              recipientName: recipient.name ?? recipient.email,
              ticketNumber: ticket.ticketNumber,
              subject: ticket.subject,
              hoursOpen,
              ticketUrl: `${frontendUrl}/dashboard/support/${ticket.id}`,
            },
          });
          if (emailResult.success) result.emailsSent++;
          else { result.emailsFailed++; result.errors.push(`Email to ${recipient.email} failed: ${emailResult.error}`); }
        }
      }
      logger.info("Support ticket unanswered automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in support ticket unanswered automation:", error);
    }
    return result;
  }

  async handleTrialAndUsageLimits(opts?: { scheduleFilter?: { currentHour: number; defaultHour: number }; organizationId?: string; forceRun?: boolean }): Promise<{
    organizationsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { organizationsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";
    const disabledOrgs = await this.getExcludedOrgIds("trial-and-usage", opts?.scheduleFilter);

    try {
      const allOrgs = await database
        .select({
          id: organizations.id,
          name: organizations.name,
          trialEndsAt: organizations.trialEndsAt,
          subscriptionStatus: organizations.subscriptionStatus,
          maxUsers: organizations.maxUsers,
          maxProjects: organizations.maxProjects,
        })
        .from(organizations)
        .where(
          and(
            ne(organizations.status, "inactive"),
            opts?.organizationId ? eq(organizations.id, opts.organizationId) : undefined,
          ),
        );

      for (const org of allOrgs) {
        if (disabledOrgs.has(org.id)) continue;

        const recipient = await this.getOrgOwnerUser(org.id);
        if (!recipient) continue;

        const upgradeUrl = `${frontendUrl}/dashboard/billing`;
        let notified = false;

        // Trial ending check
        if (
          org.subscriptionStatus === "trial" &&
          org.trialEndsAt &&
          new Date(org.trialEndsAt) <= threeDaysFromNow &&
          new Date(org.trialEndsAt) > now
        ) {
          const recentTrialNotif = opts?.forceRun ? [] : await database
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, recipient.id),
                eq(notifications.type, "trial_ending"),
                gte(notifications.createdAt, sevenDaysAgo),
              ),
            )
            .limit(1);

          if (recentTrialNotif.length === 0) {
            const daysLeft = Math.ceil((new Date(org.trialEndsAt).getTime() - now.getTime()) / 86_400_000);
            result.organizationsFound++;
            notified = true;

            await this.createNotification({
              userId: recipient.id,
              organizationId: org.id,
              type: "trial_ending",
              title: "Trial Ending Soon",
              message: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Upgrade to keep access.`,
              data: {},
            });

            const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
            if (canEmail) {
              const emailResult = await sendTransactionalEmail({
                to: recipient.email,
                toName: recipient.name ?? undefined,
                templateKey: "trial_ending",
                data: { recipientName: recipient.name ?? recipient.email, organizationName: org.name, daysLeft, upgradeUrl },
              });
              if (emailResult.success) result.emailsSent++;
              else { result.emailsFailed++; result.errors.push(`Trial email to ${recipient.email} failed: ${emailResult.error}`); }
            }
          }
        }

        // Usage limit check — users
        const [userCount] = await database.select({ c: count() }).from(userOrganizations).where(eq(userOrganizations.organizationId, org.id));
        const userUsagePercent = org.maxUsers ? Math.round(((userCount?.c ?? 0) / org.maxUsers) * 100) : 0;

        if (userUsagePercent >= 80) {
          const recentUsageNotif = opts?.forceRun ? [] : await database
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, recipient.id),
                eq(notifications.type, "plan_usage_limit"),
                gte(notifications.createdAt, sevenDaysAgo),
              ),
            )
            .limit(1);

          if (recentUsageNotif.length === 0) {
            if (!notified) result.organizationsFound++;
            notified = true;

            await this.createNotification({
              userId: recipient.id,
              organizationId: org.id,
              type: "plan_usage_limit",
              title: "Plan Usage Near Limit",
              message: `You've used ${userUsagePercent}% of your user slots (${userCount?.c ?? 0}/${org.maxUsers}).`,
              data: {},
            });

            const canEmail = await this.userEmailEnabled(recipient.id, "emailNotifications");
            if (canEmail) {
              const emailResult = await sendTransactionalEmail({
                to: recipient.email,
                toName: recipient.name ?? undefined,
                templateKey: "plan_usage_limit",
                data: { recipientName: recipient.name ?? recipient.email, organizationName: org.name, resourceName: "user seats", usagePercent: userUsagePercent, upgradeUrl },
              });
              if (emailResult.success) result.emailsSent++;
              else { result.emailsFailed++; result.errors.push(`Usage email to ${recipient.email} failed: ${emailResult.error}`); }
            }
          }
        }
      }
      logger.info("Trial and usage limits automation completed", result);
    } catch (error: any) {
      result.errors.push(error?.message ?? String(error));
      logger.error("Error in trial and usage limits automation:", error);
    }
    return result;
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
      sendPushToUser(params.userId, { title: params.title, body: params.message }).catch(() => {});
    } catch (error) {
      logger.error("Error creating notification:", error);
    }
  }
}

export const automationService = new AutomationService();
