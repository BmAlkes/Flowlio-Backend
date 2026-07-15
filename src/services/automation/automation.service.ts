import { database } from "../../configs/connection.config";
import { tasks, projects, notifications, users, userOrganizations, organizations, projectRiskAlerts, clients } from "../../schema/schema";
import { eq, and, lt, ne, sql, gte, count, isNull, or, inArray, not } from "drizzle-orm";
import { logger } from "../../utils/logger.util";
import { computeHighRiskProjects } from "../projectRisk.service";
import { checkOrgHasWeeklyActivity, generateWeeklySummary } from "../weeklySummary.service";

// How often to re-send overdue reminders for tasks that remain unresolved.
// Future: make this configurable per organization.
const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

// How often to re-alert on a project that remains at high risk.
// Future: make this configurable per organization.
const PROJECT_RISK_ALERT_INTERVAL_DAYS = 7;
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
   * Detects high-risk projects across all organizations, persists alerts,
   * sends email notifications, and auto-resolves projects that are no longer at risk.
   * Runs daily via cron.
   */
  async handleProjectRiskAlerts(): Promise<{
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

    logger.info("Running project risk alert automation...");

    try {
      const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";

      // Fetch all active organizations
      const allOrgs = await database
        .select({ id: organizations.id })
        .from(organizations);

      logger.info(`Project risk automation: found ${allOrgs.length} org(s) to evaluate`);

      for (const org of allOrgs) {
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
            if (!eligible || eligible > now) {
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
  async handleLeadFollowUpOverdue(): Promise<{
    leadsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const result = { leadsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const frontendUrl = env.FRONTEND_DOMAIN || "https://flowlioapp.com";

    logger.info("Running lead follow-up overdue automation...");

    try {
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
            or(
              isNull(clients.followupNotifiedAt),
              lt(clients.followupNotifiedAt, sevenDaysAgo),
            ),
          ),
        );

      result.leadsFound = overdueLeads.length;
      logger.info(`Lead follow-up automation: ${overdueLeads.length} overdue lead(s) found`);

      for (const lead of overdueLeads) {
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

        // In-app notification — independent of email outcome
        await this.createNotification({
          userId: recipient.id,
          organizationId: lead.organizationId,
          type: "lead_followup_overdue",
          title: "Lead Follow-up Overdue",
          message: `Follow-up for "${lead.name}" was due on ${followUpLabel}.`,
          data: { leadId: lead.id },
        });

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
  async handleWeeklySummary(): Promise<{
    organizationsFound: number;
    emailsSent: number;
    emailsFailed: number;
    errors: string[];
  }> {
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = { organizationsFound: 0, emailsSent: 0, emailsFailed: 0, errors: [] as string[] };

    const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

    logger.info(`Running weekly summary automation for week ${weekLabel}...`);

    try {
      const allOrgs = await database
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations);

      for (const org of allOrgs) {
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
