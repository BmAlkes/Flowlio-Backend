import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runSupportTicketUnansweredAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId: string | undefined = req.body?.organizationId || undefined;
    logger.info("Manual trigger: support ticket unanswered automation", { organizationId });
    const result = await automationService.handleSupportTicketUnanswered({ organizationId });
    await recordAutomationRun("support-ticket-unanswered", result, "manual", organizationId ?? null);
    res.status(200).json({ success: true, message: `Tickets found: ${result.ticketsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running support ticket unanswered automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
