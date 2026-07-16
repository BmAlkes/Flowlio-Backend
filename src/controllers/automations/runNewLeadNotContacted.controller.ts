import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runNewLeadNotContactedAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("Manual trigger: new lead not contacted automation");
    const result = await automationService.handleNewLeadNotContacted();
    await recordAutomationRun("new-lead-not-contacted", result, "manual", req.user?.organizationId ?? null);
    res.status(200).json({ success: true, message: `Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running new lead not contacted automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
