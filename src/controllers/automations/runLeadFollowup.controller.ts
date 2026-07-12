import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { logger } from "@/utils/logger.util";

export const runLeadFollowupAutomation = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("Manual trigger: lead follow-up overdue automation");
    const result = await automationService.handleLeadFollowUpOverdue();
    res.status(200).json({
      success: true,
      message: `Automation completed. Leads found: ${result.leadsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
      data: result,
    });
  } catch (error) {
    logger.error("Error running lead follow-up automation manually:", error);
    res.status(500).json({
      success: false,
      message: "Automation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
