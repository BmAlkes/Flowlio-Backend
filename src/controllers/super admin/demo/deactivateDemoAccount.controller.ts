import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { organizations } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq } from "drizzle-orm";

/**
 * Super Admin only: Toggle activate/deactivate a demo organization
 */
export const deactivateDemoAccount = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;
    if (!organizationId) {
      res
        .status(status.BAD_REQUEST)
        .json({ success: false, message: "organizationId is required" });
      return;
    }

    // Get current organization status
    const [org] = await database
      .select({
        id: organizations.id,
        status: organizations.status,
        subscriptionStatus: organizations.subscriptionStatus,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!org) {
      res
        .status(status.NOT_FOUND)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    // Toggle status: if suspended/inactive, activate; if active, deactivate
    const isCurrentlySuspended =
      org.status === "suspended" || org.status === "inactive";
    const newStatus = isCurrentlySuspended ? "active" : "suspended";
    const newSubscriptionStatus = isCurrentlySuspended ? "active" : "expired";

    const result = await database
      .update(organizations)
      .set({
        status: newStatus,
        subscriptionStatus: newSubscriptionStatus,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId))
      .returning({ id: organizations.id, status: organizations.status });

    if (result.length === 0) {
      res
        .status(status.NOT_FOUND)
        .json({ success: false, message: "Organization not found" });
      return;
    }

    const action = isCurrentlySuspended ? "reactivated" : "deactivated";
    logger.info(
      `🔄 ${
        action.charAt(0).toUpperCase() + action.slice(1)
      } demo organization ${organizationId}`
    );

    res.status(status.OK).json({
      success: true,
      message: `Demo account ${action}`,
      data: { status: newStatus },
    });
  } catch (error) {
    logger.error("Error toggling demo account status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
