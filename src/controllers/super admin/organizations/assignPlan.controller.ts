import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { organizations } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { activatePlanForOrg } from "@/utils/planActivation.util";

/**
 * Assign any plan to an organization without going through PayPal.
 * PUT /api/superadmin/organizations/:orgId/assign-plan
 */
export const assignPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const { planId, startDate, endDate, notes } = req.body;

    if (!orgId || !planId) {
      res.status(400).json({ success: false, message: "orgId and planId are required" });
      return;
    }

    const [org] = await database
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      res.status(404).json({ success: false, message: "Organization not found" });
      return;
    }

    const now = new Date();
    const periodStart = startDate ? new Date(startDate) : now;
    const periodEnd = endDate
      ? new Date(endDate)
      : new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const { orgName, planName } = await activatePlanForOrg({
      orgId,
      planId,
      periodStart,
      periodEnd,
      notes,
      assignedBy: (req as any).user?.id,
    });

    logger.info(`Plan "${planName}" manually assigned to org "${orgName}" (${orgId})`);

    res.status(200).json({
      success: true,
      message: `Plan "${planName}" assigned to "${orgName}"`,
      data: { orgId, planId, periodStart, periodEnd },
    });
  } catch (error: any) {
    logger.error("Error assigning plan:", error);
    res.status(500).json({ success: false, message: error.message ?? "Failed to assign plan" });
  }
};
