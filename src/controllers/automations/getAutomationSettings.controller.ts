import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { automationSettings } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

const ALL_AUTOMATION_KEYS = [
  "task-overdue",
  "project-risk",
  "lead-followup",
  "weekly-summary",
  "invoice-overdue",
  "payment-link-reminder",
  "webhook-issue",
  "new-lead-not-contacted",
  "client-inactivity",
  "support-ticket-unanswered",
  "trial-and-usage",
] as const;

export const getAutomationSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req.query.organizationId as string) || req.user?.organizationId;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "organizationId is required" });
      return;
    }

    const rows = await database
      .select()
      .from(automationSettings)
      .where(eq(automationSettings.organizationId, organizationId));

    const rowMap = new Map(rows.map((r) => [r.automationKey, r]));

    const data = ALL_AUTOMATION_KEYS.map((key) => {
      const existing = rowMap.get(key);
      return {
        automationKey: key,
        organizationId,
        enabled: existing?.enabled ?? true,
        scheduleHourUtc: existing?.scheduleHourUtc ?? null,
        lastScheduledRunAt: existing?.lastScheduledRunAt ?? null,
      };
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    logger.error("Error fetching automation settings:", error);
    res.status(500).json({ success: false, message: "Failed to fetch automation settings" });
  }
};
