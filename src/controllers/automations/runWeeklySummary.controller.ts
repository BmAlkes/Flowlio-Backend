import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { logger } from "@/utils/logger.util";

export const runWeeklySummaryAutomation = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("Manual trigger: weekly summary automation");
    const result = await automationService.handleWeeklySummary();
    res.status(200).json({
      success: true,
      message: `Automation completed. Organizations with activity: ${result.organizationsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
      data: result,
    });
  } catch (error) {
    logger.error("Error running weekly summary automation manually:", error);
    res.status(500).json({
      success: false,
      message: "Automation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
