import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runProjectRiskAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("Manual trigger: project risk alert automation");
    const result = await automationService.handleProjectRiskAlerts();
    await recordAutomationRun("project-risk", result, "manual", req.user?.organizationId ?? null);
    res.status(200).json({ success: true, message: `Projects found: ${result.projectsFound}, alerts created: ${result.alertsCreated}, resolved: ${result.alertsResolved}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running project risk automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
