import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { logger } from "@/utils/logger.util";

export const runTaskOverdueAutomation = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("Manual trigger: task overdue automation");
    const result = await automationService.handleOverdueTasks();
    res.status(200).json({
      success: true,
      message: `Automation completed. Tasks found: ${result.tasksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
      data: result,
    });
  } catch (error) {
    logger.error("Error running task overdue automation manually:", error);
    res.status(500).json({
      success: false,
      message: "Automation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
