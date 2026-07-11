import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { logger } from "@/utils/logger.util";

export const runProjectRiskAutomation = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("Manual trigger: project risk alert automation");
    const result = await automationService.handleProjectRiskAlerts();
    res.status(200).json({
      success: true,
      message: `Automation completed. Projects found: ${result.projectsFound}, alerts created: ${result.alertsCreated}, resolved: ${result.alertsResolved}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`,
      data: result,
    });
  } catch (error) {
    logger.error("Error running project risk automation manually:", error);
    res.status(500).json({
      success: false,
      message: "Automation failed",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
