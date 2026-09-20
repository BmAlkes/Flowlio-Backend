import type { Request, Response } from "express";
import type { AutomationResult } from "@/utils/automationRun.util";
import { runManualAutomation } from "@/modules/automations/run-manual-automation";
import { logger } from "@/utils/logger.util";

interface ManualAutomation<T extends AutomationResult> {
  key: string;
  run: (organizationId: string | undefined) => Promise<T>;
  message: (result: T) => string;
  logStart: string;
  logError: string;
}

export function createManualAutomationController<T extends AutomationResult>(definition: ManualAutomation<T>) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const organizationId = (req.body?.organizationId as string)?.trim() || undefined;
      const isSuperAdmin = !!req.user?.isSuperAdmin;
      logger.info(definition.logStart, { organizationId, isSuperAdmin });
      if (!organizationId && !isSuperAdmin) {
        res.status(400).json({ success: false, message: "organizationId is required" });
        return;
      }
      const result = await runManualAutomation(definition.key, organizationId, definition.run);
      res.status(200).json({ success: true, message: definition.message(result), data: result });
    } catch (error) {
      logger.error(definition.logError, error);
      res.status(500).json({ success: false, message: "Automation failed", error: error instanceof Error ? error.message : "Unknown error" });
    }
  };
}
