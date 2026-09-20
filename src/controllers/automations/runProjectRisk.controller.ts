import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runProjectRiskAutomation = createManualAutomationController({
  key: "project-risk",
  run: (organizationId) => automationService.handleProjectRiskAlerts({ organizationId, forceRun: true }),
  message: (result) => `Projects found: ${result.projectsFound}, alerts created: ${result.alertsCreated}, resolved: ${result.alertsResolved}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: project risk alert automation",
  logError: "Error running project risk automation manually:",
});
