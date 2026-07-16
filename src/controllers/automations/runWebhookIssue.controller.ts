import { Request, Response } from "express";
import { automationService } from "@/services/automation/automation.service";
import { recordAutomationRun } from "@/utils/automationRun.util";
import { logger } from "@/utils/logger.util";

export const runWebhookIssueAutomation = async (req: Request, res: Response): Promise<void> => {
  try {
    logger.info("Manual trigger: webhook issue automation");
    const result = await automationService.handleWebhookIssue();
    await recordAutomationRun("webhook-issue", result, "manual", req.user?.organizationId ?? null);
    res.status(200).json({ success: true, message: `Webhooks with issues: ${result.webhooksFound}, emails sent: ${result.emailsSent}, failed: ${result.emailsFailed}.`, data: result });
  } catch (error) {
    logger.error("Error running webhook issue automation manually:", error);
    res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
  }
};
