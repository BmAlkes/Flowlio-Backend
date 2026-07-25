import cron from "node-cron";
import crypto from "crypto";
import { automationService } from "./automation.service";
import { RecurringInvoiceService } from "../recurringInvoice.service";
import { logger } from "../../utils/logger.util";
import { database } from "../../configs/connection.config";
import { connection } from "../../configs/connection.config";
import { aiTokenLimits, leadWebhookLogs, notifications } from "../../schema/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { nextMonthReset } from "../../utils/aiTokenLimit.util";
import { recordAutomationRun } from "../../utils/automationRun.util";

/**
 * Initializes and starts all backend cron jobs
 */
export const initCronJobs = () => {
  logger.info("Initializing scheduled automation jobs...");

  // Fixed @ 08:00 UTC — project-end reminders + recurring invoices (no per-org schedule)
  cron.schedule("0 8 * * *", async () => {
    logger.info("Running 08:00 fixed automation batch (project-end reminders + recurring invoices)...");
    try {
      await automationService.handleProjectEndReminders();
      await RecurringInvoiceService.processRecurringInvoices();
      logger.info("08:00 fixed automation batch completed.");
    } catch (error) {
      logger.error("Error in 08:00 fixed automation batch:", error);
    }
  });

  // Hourly: task-overdue (default 08:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleOverdueTasks({ scheduleFilter: { currentHour, defaultHour: 8 } });
      await recordAutomationRun("task-overdue", result, "cron");
    } catch (error) {
      logger.error("Error running task-overdue automation:", error);
    }
  });

  // Hourly: project-risk (default 09:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleProjectRiskAlerts({ scheduleFilter: { currentHour, defaultHour: 9 } });
      await recordAutomationRun("project-risk", result, "cron");
    } catch (error) {
      logger.error("Error running project-risk automation:", error);
    }
  });

  // Hourly: lead-followup (default 10:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleLeadFollowUpOverdue({ scheduleFilter: { currentHour, defaultHour: 10 } });
      await recordAutomationRun("lead-followup", result, "cron");
    } catch (error) {
      logger.error("Error running lead-followup automation:", error);
    }
  });

  // Hourly on Mondays: weekly-summary (default 08:00 UTC, orgs may override)
  cron.schedule("0 * * * 1", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleWeeklySummary({ scheduleFilter: { currentHour, defaultHour: 8 } });
      await recordAutomationRun("weekly-summary", result, "cron");
    } catch (error) {
      logger.error("Error running weekly-summary automation:", error);
    }
  });

  // Hourly: invoice-overdue (default 11:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleInvoiceOverdue({ scheduleFilter: { currentHour, defaultHour: 11 } });
      await recordAutomationRun("invoice-overdue", result, "cron");
    } catch (error) {
      logger.error("Error running invoice-overdue automation:", error);
    }
  });

  // Hourly: payment-link-reminder (default 12:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handlePaymentLinkReminder({ scheduleFilter: { currentHour, defaultHour: 12 } });
      await recordAutomationRun("payment-link-reminder", result, "cron");
    } catch (error) {
      logger.error("Error running payment-link-reminder automation:", error);
    }
  });

  // Fixed every 6 hours: webhook-issue (no per-org schedule)
  cron.schedule("0 */6 * * *", async () => {
    try {
      const result = await automationService.handleWebhookIssue();
      await recordAutomationRun("webhook-issue", result, "cron");
    } catch (error) {
      logger.error("Error running webhook-issue automation:", error);
    }
  });

  // Fixed every 6 hours: new-lead-not-contacted (no per-org schedule)
  cron.schedule("0 */6 * * *", async () => {
    try {
      const result = await automationService.handleNewLeadNotContacted();
      await recordAutomationRun("new-lead-not-contacted", result, "cron");
    } catch (error) {
      logger.error("Error running new-lead-not-contacted automation:", error);
    }
  });

  // Hourly on Sundays: client-inactivity (default 09:00 UTC, orgs may override)
  cron.schedule("0 * * * 0", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleClientInactivity({ scheduleFilter: { currentHour, defaultHour: 9 } });
      await recordAutomationRun("client-inactivity", result, "cron");
    } catch (error) {
      logger.error("Error running client-inactivity automation:", error);
    }
  });

  // Fixed every 6 hours: support-ticket-unanswered (no per-org schedule)
  cron.schedule("0 */6 * * *", async () => {
    try {
      const result = await automationService.handleSupportTicketUnanswered();
      await recordAutomationRun("support-ticket-unanswered", result, "cron");
    } catch (error) {
      logger.error("Error running support-ticket-unanswered automation:", error);
    }
  });

  // Hourly: trial-and-usage (default 06:00 UTC, orgs may override)
  cron.schedule("0 * * * *", async () => {
    const currentHour = new Date().getUTCHours();
    try {
      const result = await automationService.handleTrialAndUsageLimits({ scheduleFilter: { currentHour, defaultHour: 6 } });
      await recordAutomationRun("trial-and-usage", result, "cron");
    } catch (error) {
      logger.error("Error running trial-and-usage automation:", error);
    }
  });

  // Daily AI token reset: resets tokensUsed for orgs whose monthly period has expired
  cron.schedule("0 0 * * *", async () => {
    try {
      const now = new Date();
      await database
        .update(aiTokenLimits)
        .set({
          tokensUsed: 0,
          resetAt: nextMonthReset(),
          updatedAt: now,
        })
        .where(
          and(
            eq(aiTokenLimits.isActive, true),
            lte(aiTokenLimits.resetAt, now)
          )
        );
      logger.info("AI token monthly reset completed.");
    } catch (error) {
      logger.error("Error resetting AI token usage:", error);
    }
  });

  // Webhook retry processor: every minute, reprocess failed webhooks with pending retries
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const pendingLogs = await database
        .select()
        .from(leadWebhookLogs)
        .where(
          and(
            sql`${leadWebhookLogs.status} = 'pending_retry'`,
            lte(leadWebhookLogs.nextRetryAt, now)
          )
        )
        .limit(10);

      for (const log of pendingLogs) {
        try {
          const payload = log.payload as Record<string, any>;
          if (!payload || !log.webhookId) continue;

          // Re-fetch webhook to get org_id and mapping
          const whRes = await connection.query({
            text: `SELECT org_id, name, field_mapping FROM lead_webhooks WHERE id = $1 AND active = true`,
            values: [log.webhookId],
          });
          if (whRes.rows.length === 0) continue;

          const wh = whRes.rows[0];
          const mapping: Record<string, string> = wh.field_mapping ?? {};
          const mapped: Record<string, any> = {};
          for (const [ext, lead] of Object.entries(mapping)) {
            if (payload[ext] !== undefined) mapped[lead] = payload[ext];
          }

          const leadName = (mapped.name || payload.name || "Lead sem nome") as string;
          const leadEmail = (mapped.email || payload.email || `retry-${crypto.randomUUID()}@noemail.invalid`) as string;

          // Find org user
          const userRes = await connection.query({
            text: `SELECT user_id FROM user_organizations WHERE organization_id = $1 ORDER BY CASE WHEN role='owner' THEN 0 ELSE 1 END LIMIT 1`,
            values: [wh.org_id],
          });
          if (userRes.rows.length === 0) continue;

          const newLeadId = crypto.randomUUID();
          await connection.query({
            text: `INSERT INTO clients (id, organization_id, name, email, status, type, webhook_id, webhook_name, created_by, position, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, 'New Lead', 'lead', $5, $6, $7, 0, now(), now())`,
            values: [newLeadId, wh.org_id, leadName, leadEmail, log.webhookId, wh.name, userRes.rows[0].user_id],
          });

          await database
            .update(leadWebhookLogs)
            .set({ status: "retried_success" as any, leadId: newLeadId, retryCount: (log.retryCount ?? 0) + 1 })
            .where(eq(leadWebhookLogs.id, log.id));

        } catch (retryErr: any) {
          const retryCount = (log.retryCount ?? 0) + 1;
          const maxRetries = log.maxRetries ?? 3;

          if (retryCount >= maxRetries) {
            await database
              .update(leadWebhookLogs)
              .set({ status: "permanently_failed" as any, retryCount, error: retryErr.message })
              .where(eq(leadWebhookLogs.id, log.id));
          } else {
            // Exponential backoff: 1min, 5min, 30min
            const delays = [60_000, 300_000, 1_800_000];
            const nextDelay = delays[Math.min(retryCount, delays.length - 1)];
            await database
              .update(leadWebhookLogs)
              .set({
                retryCount,
                nextRetryAt: new Date(Date.now() + nextDelay),
                error: retryErr.message,
              })
              .where(eq(leadWebhookLogs.id, log.id));
          }
        }
      }
    } catch (error) {
      logger.error("Webhook retry processor error:", error);
    }
  });

  // Follow-up reminders: hourly, notify assigned users about due/overdue follow-ups
  cron.schedule("0 * * * *", async () => {
    try {
      const now = new Date();
      const rows = await connection.query({
        text: `
          SELECT c.id, c.name, c.assigned_to, c.organization_id, c.follow_up_at,
                 c.followup_notified_at, c.follow_up_note
          FROM clients c
          WHERE c.type IN ('lead', 'client')
            AND c.follow_up_at IS NOT NULL
            AND c.follow_up_at <= $1
            AND c.status NOT IN ('lost', 'Completed', 'Inactive')
            AND (c.followup_notified_at IS NULL OR c.followup_notified_at < c.follow_up_at)
          LIMIT 100
        `,
        values: [now],
      });

      for (const lead of rows.rows) {
        let notifyUserId = lead.assigned_to;

        if (!notifyUserId) {
          const ownerRes = await connection.query({
            text: `SELECT user_id FROM user_organizations WHERE organization_id = $1 AND role = 'owner' LIMIT 1`,
            values: [lead.organization_id],
          });
          notifyUserId = ownerRes.rows[0]?.user_id;
        }

        if (!notifyUserId) continue;

        const hoursOverdue = (now.getTime() - new Date(lead.follow_up_at).getTime()) / 3_600_000;
        const isOverdue = hoursOverdue > 24;

        const noteSuffix = lead.follow_up_note ? ` — ${lead.follow_up_note}` : "";
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: notifyUserId,
          organizationId: lead.organization_id,
          type: isOverdue ? "lead_followup_overdue" : "lead_followup_due",
          title: isOverdue ? `Overdue follow-up: ${lead.name}` : `Follow-up due: ${lead.name}`,
          message: isOverdue
            ? `Follow-up with ${lead.name} was due ${Math.floor(hoursOverdue / 24)} days ago.${noteSuffix}`
            : `Your follow-up with ${lead.name} is due today.${noteSuffix}`,
          read: false,
        });

        await connection.query({
          text: `UPDATE clients SET followup_notified_at = $1 WHERE id = $2`,
          values: [now, lead.id],
        });
      }

      if (rows.rows.length > 0) {
        logger.info(`Follow-up reminders sent for ${rows.rows.length} leads.`);
      }
    } catch (error) {
      logger.error("Follow-up reminder cron error:", error);
    }
  });

  logger.info("Cron jobs scheduled.");
};
