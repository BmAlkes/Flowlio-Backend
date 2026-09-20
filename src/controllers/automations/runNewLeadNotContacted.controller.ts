import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runNewLeadNotContactedAutomation = createManualAutomationController({
  key: "new-lead-not-contacted",
  run: (organizationId) => automationService.handleNewLeadNotContacted({ organizationId, forceRun: true }),
  message: (result) => `Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: new lead not contacted automation",
  logError: "Error running new lead not contacted automation manually:",
});
