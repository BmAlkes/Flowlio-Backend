import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../schema/schema";
import { automationService } from "../automation/automation.service";
import { RecurringInvoiceService } from "../recurringInvoice.service";
import { recordAutomationRun } from "../../utils/automationRun.util";
import { jobContext } from "./context";
import { retryWebhooks, followupReminders } from "./database-handlers";
import { enqueue, type Handler, type Schedule } from "./queue";
import { sendTransactionalEmail } from "../email/transactional.service";
import { sendPushToUser } from "../../utils/web-push.util";
import { backgroundSyncService } from "../backgroundSync.service";
import { autoRenewalService } from "../autoRenewal.service";
import { nextMonthReset } from "../../utils/aiTokenLimit.util";
const automations = [
    ["task-overdue", "handleOverdueTasks", 8], ["project-risk", "handleProjectRiskAlerts", 9],
    ["lead-followup", "handleLeadFollowUpOverdue", 10], ["weekly-summary", "handleWeeklySummary", 8, 1],
    ["invoice-overdue", "handleInvoiceOverdue", 11], ["payment-link-reminder", "handlePaymentLinkReminder", 12],
    ["webhook-issue", "handleWebhookIssue"], ["new-lead-not-contacted", "handleNewLeadNotContacted"],
    ["client-inactivity", "handleClientInactivity", 9, 0], ["support-ticket-unanswered", "handleSupportTicketUnanswered"],
    ["trial-and-usage", "handleTrialAndUsageLimits", 6],
] as const;
export const schedules: Schedule[] = [
    ...automations.map(([kind, , hour, weekday]) => ({ kind, minutes: hour === undefined ? 360 : 60, weekday })),
    { kind: "project-end", minutes: 1440, hour: 8 }, { kind: "recurring-invoices", minutes: 1440, hour: 8 },
    { kind: "ai-reset", minutes: 1440, hour: 0 }, { kind: "webhook-retries", minutes: 1 }, { kind: "followup-reminders", minutes: 60 },
    { kind: "subscription-renewal", minutes: 1440, hour: 0 },
    { kind: "calendar-sync", minutes: 60 },
];
const transactional = (run: Handler["run"]): Handler => ({
    transactional: true, run: (job, client) => jobContext.run({ job, client, database: drizzle(client, { schema, casing: "snake_case" }) }, () => run(job, client))
});
export const handlers: Record<string, Handler> = {
    "project-end": transactional(async () => { await automationService.handleProjectEndReminders(); }),
    "recurring-invoices": transactional(async () => { await RecurringInvoiceService.processRecurringInvoices(); }),
    "webhook-retries": transactional(async (_job, client) => { await retryWebhooks(client); }),
    "followup-reminders": transactional(async (_job, client) => { await followupReminders(client); }),
    "ai-reset": transactional(async (_job, client) => {
        await client.query("UPDATE ai_token_limits SET tokens_used=0,reset_at=$1,updated_at=now() WHERE is_active=true AND period='monthly' AND reset_at<=now()", [nextMonthReset()]);
    }),
    // External providers cannot participate in our transaction. Interrupted deliveries require reconciliation.
    "email-delivery": {
        transactional: false, run: async (job, client) => {
            const result = await sendTransactionalEmail(job.payload as Parameters<typeof sendTransactionalEmail>[0]);
            if (job.payload.automationRunId)
                await client.query("UPDATE automation_runs SET emails_sent=emails_sent+$2,emails_failed=emails_failed+$3 WHERE id=$1", [job.payload.automationRunId, result.success ? 1 : 0, result.success ? 0 : 1]);
            if (!result.success)
                throw new Error("Email delivery unconfirmed");
        }
    },
    "push-delivery": {
        transactional: false, run: async (job) => {
            await sendPushToUser(String(job.payload.userId), { title: String(job.payload.title), body: String(job.payload.body) }, true);
        }
    },
    "calendar-sync": {
        transactional: false, run: async (job, client) => {
            if (job.payload.userId)
                await backgroundSyncService.forceSyncUser(String(job.payload.userId), true);
            else if ((await client.query("SELECT enabled FROM job_schedules WHERE kind='calendar-sync'")).rows[0]?.enabled)
                await backgroundSyncService.performBackgroundSync(true);
        }
    },
    "subscription-renewal": { transactional: false, run: async () => { await autoRenewalService.performAutoRenewal(true); } },
};
for (const [kind, method, defaultHour] of automations) {
    handlers[kind] = transactional(async (job, client) => {
        // Old weekly slots must not regenerate the current week's summary repeatedly after a long outage.
        if (kind === "weekly-summary" && Date.now() - new Date(job.scheduled_at).getTime() >= 7 * 24 * 60 * 60 * 1000)
            return;
        if (!job.payload.organizationId) {
            const organizations = await client.query("SELECT id FROM organizations ORDER BY id");
            for (const org of organizations.rows)
                await enqueue(client, kind, job.id + ":" + org.id, { organizationId: org.id }, job.scheduled_at);
            return;
        }
        const options = { organizationId: String(job.payload.organizationId), ...(defaultHour === undefined ? {} : { scheduleFilter: { currentHour: new Date(job.scheduled_at).getUTCHours(), defaultHour } }) };
        const result = await automationService[method](options);
        if (result.errors.length || result.emailsFailed)
            throw new Error("Automation batch incomplete: " + kind);
        await recordAutomationRun(kind, result, "cron", options.organizationId);
    });
    if (kind === "weekly-summary")
        handlers[kind].retryable = false; // AI calls can already have consumed credits.
}
