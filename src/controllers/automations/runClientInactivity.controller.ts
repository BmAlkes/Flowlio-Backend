import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runClientInactivityAutomation = createManualAutomationController({
  key: "client-inactivity",
  run: (organizationId) => automationService.handleClientInactivity({ organizationId, forceRun: true }),
  message: (result) => `Clients found: ${result.clientsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: client inactivity automation",
  logError: "Error running client inactivity automation manually:",
});
