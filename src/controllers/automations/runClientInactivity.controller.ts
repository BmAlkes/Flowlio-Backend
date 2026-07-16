import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runClientInactivityAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("Manual trigger: client inactivity automation");
    const result = await automationService.handleClientInactivity();
    await recordAutomationRun("client-inactivity", result, "manual", req.user?.organizationId ?? null);
    res.status(200).json({ success: true, message: `Clients found: ${result.clientsFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running client inactivity automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
