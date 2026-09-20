import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runLeadFollowupAutomation = createManualAutomationController({
  key: "lead-followup",
  run: (organizationId) => automationService.handleLeadFollowUpOverdue({ organizationId, forceRun: true }),
  message: (result) => `Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: lead follow-up overdue automation",
  logError: "Error running lead follow-up automation manually:",
});
