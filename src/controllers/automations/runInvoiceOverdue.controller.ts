import { automationService } from "@/services/automation/automation.service";
import { createManualAutomationController } from "./manual-automation.controller";

export const runInvoiceOverdueAutomation = createManualAutomationController({
  key: "invoice-overdue",
  run: (organizationId) => automationService.handleInvoiceOverdue({ organizationId, forceRun: true }),
  message: (result) => `Invoices found: ${result.invoicesFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
  logStart: "Manual trigger: invoice overdue automation",
  logError: "Error running invoice overdue automation manually:",
});
