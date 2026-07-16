import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { automationSettings } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@/utils/logger.util";

const schema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean().optional(),
  scheduleHourUtc: z.number().int().min(0).max(23).nullable().optional(),
});

export const updateAutomationSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const bodyResult = schema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ success: false, message: "Validation failed", errors: bodyResult.error.errors });
      return;
    }

    const { organizationId, enabled, scheduleHourUtc } = bodyResult.data;

    if (enabled === undefined && scheduleHourUtc === undefined) {
      res.status(400).json({ success: false, message: "Provide at least one of: enabled, scheduleHourUtc" });
      return;
    }

    const existing = await database
      .select({ id: automationSettings.id, enabled: automationSettings.enabled, scheduleHourUtc: automationSettings.scheduleHourUtc })
      .from(automationSettings)
      .where(and(eq(automationSettings.organizationId, organizationId), eq(automationSettings.automationKey, key)))
      .limit(1);

    // Build partial update — only overwrite fields that were explicitly sent
    const patch: Record<string, unknown> = {};
    if (enabled !== undefined) patch.enabled = enabled;
    if (scheduleHourUtc !== undefined) patch.scheduleHourUtc = scheduleHourUtc;

    let resultRow: { automationKey: string; organizationId: string; enabled: boolean; scheduleHourUtc: number | null };

    if (existing.length > 0) {
      const [updated] = await database
        .update(automationSettings)
        .set(patch)
        .where(and(eq(automationSettings.organizationId, organizationId), eq(automationSettings.automationKey, key)))
        .returning({ enabled: automationSettings.enabled, scheduleHourUtc: automationSettings.scheduleHourUtc });

      resultRow = { automationKey: key, organizationId, enabled: updated.enabled, scheduleHourUtc: updated.scheduleHourUtc ?? null };
    } else {
      const [inserted] = await database
        .insert(automationSettings)
        .values({ organizationId, automationKey: key, ...patch })
        .returning({ enabled: automationSettings.enabled, scheduleHourUtc: automationSettings.scheduleHourUtc });

      resultRow = { automationKey: key, organizationId, enabled: inserted.enabled, scheduleHourUtc: inserted.scheduleHourUtc ?? null };
    }

    logger.info(`Automation "${key}" settings updated for org ${organizationId}`, patch);
    res.status(200).json({ success: true, data: resultRow });
  } catch (error) {
    logger.error("Error updating automation settings:", error);
    res.status(500).json({ success: false, message: "Failed to update automation settings" });
  }
};
