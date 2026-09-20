import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runSupportTicketUnansweredAutomation = createManualAutomationController({
  key: "support-ticket-unanswered",
  run: (organizationId) => automationService.handleSupportTicketUnanswered({ organizationId, forceRun: true }),
  message: (result) => `Tickets found: ${result.ticketsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: support ticket unanswered automation",
  logError: "Error running support ticket unanswered automation manually:",
});
