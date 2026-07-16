import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runLeadFollowupAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId: string | undefined = req.body?.organizationId || undefined;
    logger.info("Manual trigger: lead follow-up overdue automation", { organizationId });
    const result = await automationService.handleLeadFollowUpOverdue({ organizationId });
    await recordAutomationRun("lead-followup", result, "manual", organizationId ?? null);
    res.status(200).json({ success: true, message: `Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running lead follow-up automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
