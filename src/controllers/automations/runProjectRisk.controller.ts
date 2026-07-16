import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runProjectRiskAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId: string | undefined = (req.body?.organizationId as string)?.trim() || undefined;
    const isSuperAdmin = !!(req.user as any)?.isSuperAdmin;
    logger.info("Manual trigger: project risk alert automation", { organizationId, isSuperAdmin });
    if (!organizationId && !isSuperAdmin) {
      res.status(400).json({ success: false, message: "organizationId is required" });
      return;
    }
    const result = await automationService.handleProjectRiskAlerts({ organizationId, forceRun: true });
    await recordAutomationRun("project-risk", result, "manual", organizationId ?? null);
    res.status(200).json({ success: true, message: `Projects found: ${result.projectsFound}, alerts created: ${result.alertsCreated}, resolved: ${result.alertsResolved}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running project risk automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
