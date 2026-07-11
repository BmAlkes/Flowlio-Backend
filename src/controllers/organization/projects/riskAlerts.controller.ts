import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectRiskAlerts } from "@/schema/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const getProjectRiskAlerts = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId as string;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization ID is required" });
      return;
    }

    const { projectId } = req.query;

    const conditions = [
      eq(projectRiskAlerts.organizationId, organizationId),
      eq(projectRiskAlerts.status, "active"),
    ];

    if (projectId && typeof projectId === "string") {
      conditions.push(eq(projectRiskAlerts.projectId, projectId));
    }

    const alerts = await database
      .select()
      .from(projectRiskAlerts)
      .where(and(...conditions))
      .orderBy(projectRiskAlerts.createdAt);

    res.status(200).json({ success: true, data: alerts });
  } catch (error) {
    logger.error("Error fetching project risk alerts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch project risk alerts",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const dismissProjectRiskAlert = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId as string;
    const userId = req.user?.id as string;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization ID is required" });
      return;
    }

    const { id } = req.params;
    const now = new Date();
    const nextEligibleAt = new Date(
      now.getTime() + 7 * 24 * 60 * 60 * 1000,
    );

    const updated = await database
      .update(projectRiskAlerts)
      .set({
        status: "dismissed",
        dismissedAt: now,
        dismissedBy: userId ?? null,
        nextEligibleAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(projectRiskAlerts.id, id),
          eq(projectRiskAlerts.organizationId, organizationId),
          eq(projectRiskAlerts.status, "active"),
        ),
      )
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ success: false, message: "Alert not found or already dismissed" });
      return;
    }

    res.status(200).json({ success: true, data: updated[0] });
  } catch (error) {
    logger.error("Error dismissing project risk alert:", error);
    res.status(500).json({
      success: false,
      message: "Failed to dismiss alert",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
