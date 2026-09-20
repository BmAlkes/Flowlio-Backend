import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runTrialAndUsageAutomation = createManualAutomationController({
  key: "trial-and-usage",
  run: (organizationId) => automationService.handleTrialAndUsageLimits({ organizationId, forceRun: true }),
  message: (result) => `Organizations found: ${result.organizationsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: trial and usage limits automation",
  logError: "Error running trial and usage automation manually:",
});
