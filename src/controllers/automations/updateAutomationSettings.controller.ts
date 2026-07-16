import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { automationSettings } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { logger } from "@/utils/logger.util";

const schema = z.object({
  organizationId: z.string().min(1),
  enabled: z.boolean(),
});

export const updateAutomationSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const bodyResult = schema.safeParse(req.body);
    if (!bodyResult.success) {
      res.status(400).json({ success: false, message: "Validation failed", errors: bodyResult.error.errors });
      return;
    }

    const { organizationId, enabled } = bodyResult.data;

    // Upsert
    const existing = await database
      .select({ id: automationSettings.id })
      .from(automationSettings)
      .where(and(eq(automationSettings.organizationId, organizationId), eq(automationSettings.automationKey, key)))
      .limit(1);

    if (existing.length > 0) {
      await database
        .update(automationSettings)
        .set({ enabled })
        .where(and(eq(automationSettings.organizationId, organizationId), eq(automationSettings.automationKey, key)));
    } else {
      await database.insert(automationSettings).values({ organizationId, automationKey: key, enabled });
    }

    logger.info(`Automation "${key}" for org ${organizationId} set to enabled=${enabled}`);
    res.status(200).json({ success: true, message: `Automation "${key}" ${enabled ? "enabled" : "disabled"}`, data: { automationKey: key, organizationId, enabled } });
  } catch (error) {
    logger.error("Error updating automation settings:", error);
    res.status(500).json({ success: false, message: "Failed to update automation settings" });
  }
};
