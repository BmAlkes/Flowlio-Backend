import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { automationRuns } from "@/schema/schema";
import { eq, and, or, isNull, desc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const getAutomationHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { key } = req.params;
    const organizationId = (req.query.organizationId as string) || req.user?.organizationId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;

    if (!organizationId) {
      res.status(400).json({ success: false, message: "organizationId is required" });
      return;
    }

    const rows = await database
      .select()
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.automationKey, key),
          or(eq(automationRuns.organizationId, organizationId), isNull(automationRuns.organizationId)),
        ),
      )
      .orderBy(desc(automationRuns.runAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json({ success: true, data: rows, page, limit });
  } catch (error) {
    logger.error("Error fetching automation history:", error);
    res.status(500).json({ success: false, message: "Failed to fetch automation history" });
  }
};
