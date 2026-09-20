import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runWeeklySummaryAutomation = createManualAutomationController({
  key: "weekly-summary",
  run: (organizationId) => automationService.handleWeeklySummary({ organizationId }),
  message: (result) => `Organizations with activity: ${result.organizationsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: weekly summary automation",
  logError: "Error running weekly summary automation manually:",
});
