import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runTaskOverdueAutomation = createManualAutomationController({
  key: "task-overdue",
  run: (organizationId) => automationService.handleOverdueTasks({ organizationId, forceRun: true }),
  message: (result) => `Tasks found: ${result.tasksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: task overdue automation",
  logError: "Error running task overdue automation manually:",
});
