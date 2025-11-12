import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { organizations, userOrganizations } from "@/schema/schema";
import { eq } from "drizzle-orm";

/**
 * Mark password as changed for demo user
 * This endpoint is called after a demo user successfully changes their password
 */
export const markPasswordChanged = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;

    // Get user's organization
    const userOrg = await database
      .select({
        organizationId: userOrganizations.organizationId,
        orgSettings: organizations.settings,
      })
      .from(userOrganizations)
      .innerJoin(
        organizations,
        eq(userOrganizations.organizationId, organizations.id)
      )
      .where(eq(userOrganizations.userId, userId))
      .limit(1);

    if (userOrg.length === 0) {
      res.status(404).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    const orgData = userOrg[0];
    const settings = (orgData.orgSettings as any) || {};

    // Check if this is a demo organization
    if (settings.demo !== true) {
      res.status(400).json({
        success: false,
        message: "This endpoint is only for demo accounts",
      });
      return;
    }

    // Update passwordChanged flag in organization settings
    const updatedSettings = {
      ...settings,
      passwordChanged: true,
    };

    await database
      .update(organizations)
      .set({
        settings: updatedSettings as any,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, orgData.organizationId));

    logger.info(
      `✅ Password marked as changed for demo user ${userId} in organization ${orgData.organizationId}`
    );

    res.status(200).json({
      success: true,
      message: "Password change status updated successfully",
    });
  } catch (error) {
    logger.error("Error marking password as changed:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

