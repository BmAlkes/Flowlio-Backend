import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runPaymentLinkReminderAutomation = createManualAutomationController({
  key: "payment-link-reminder",
  run: (organizationId) => automationService.handlePaymentLinkReminder({ organizationId, forceRun: true }),
  message: (result) => `Links found: ${result.linksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: payment link reminder automation",
  logError: "Error running payment link reminder automation manually:",
});
