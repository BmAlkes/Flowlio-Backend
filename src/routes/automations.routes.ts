import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { runTaskOverdueAutomation } from "@/controllers/automations/runTaskOverdue.controller";
import { runProjectRiskAutomation } from "@/controllers/automations/runProjectRisk.controller";
import { runLeadFollowupAutomation } from "@/controllers/automations/runLeadFollowup.controller";
import { runWeeklySummaryAutomation } from "@/controllers/automations/runWeeklySummary.controller";
import { runInvoiceOverdueAutomation } from "@/controllers/automations/runInvoiceOverdue.controller";
import { runPaymentLinkReminderAutomation } from "@/controllers/automations/runPaymentLinkReminder.controller";
import { runWebhookIssueAutomation } from "@/controllers/automations/runWebhookIssue.controller";
import { runNewLeadNotContactedAutomation } from "@/controllers/automations/runNewLeadNotContacted.controller";
import { runClientInactivityAutomation } from "@/controllers/automations/runClientInactivity.controller";
import { runSupportTicketUnansweredAutomation } from "@/controllers/automations/runSupportTicketUnanswered.controller";
import { runTrialAndUsageAutomation } from "@/controllers/automations/runTrialAndUsage.controller";
import { getAutomationHistory } from "@/controllers/automations/getAutomationHistory.controller";
import { getAutomationSettings } from "@/controllers/automations/getAutomationSettings.controller";
import { updateAutomationSettings } from "@/controllers/automations/updateAutomationSettings.controller";

const router = Router();

// Manual triggers — org owner / manager / superadmin
const access = [isAuthenticated, requireOrgOwnerAccess];

router.post("/task-overdue/run", ...access, runTaskOverdueAutomation as any);
router.post("/project-risk/run", ...access, runProjectRiskAutomation as any);
router.post("/lead-followup/run", ...access, runLeadFollowupAutomation as any);
router.post("/weekly-summary/run", ...access, runWeeklySummaryAutomation as any);
router.post("/invoice-overdue/run", ...access, runInvoiceOverdueAutomation as any);
router.post("/payment-link-reminder/run", ...access, runPaymentLinkReminderAutomation as any);
router.post("/webhook-issue/run", ...access, runWebhookIssueAutomation as any);
router.post("/new-lead-not-contacted/run", ...access, runNewLeadNotContactedAutomation as any);
router.post("/client-inactivity/run", ...access, runClientInactivityAutomation as any);
router.post("/support-ticket-unanswered/run", ...access, runSupportTicketUnansweredAutomation as any);
router.post("/trial-and-usage/run", ...access, runTrialAndUsageAutomation as any);

// History + settings
router.get("/settings", ...access, getAutomationSettings as any);
router.get("/:key/history", ...access, getAutomationHistory as any);
router.patch("/:key/settings", ...access, updateAutomationSettings as any);

export default router;
