import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runWebhookIssueAutomation = createManualAutomationController({
  key: "webhook-issue",
  run: (organizationId) => automationService.handleWebhookIssue({ organizationId }),
  message: (result) => `Webhooks with issues: ${result.webhooksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: webhook issue automation",
  logError: "Error running webhook issue automation manually:",
});
