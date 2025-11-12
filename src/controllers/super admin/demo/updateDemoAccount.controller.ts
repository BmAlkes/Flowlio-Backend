import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { organizations, userOrganizations } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq } from "drizzle-orm";

/**
 * Update demo account - trial duration or convert to regular client
 * PUT /superadmin/demo-accounts/:organizationId
 */
export const updateDemoAccount = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { organizationId } = req.params;
    const { trialEndsAt, trialDays, convertToClient } = req.body as {
      trialEndsAt?: string; // ISO date string
      trialDays?: number; // Number of days from now (to extend)
      convertToClient?: boolean; // Convert demo to regular client
    };

    if (!organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Check if organization exists and is a demo account
    const org = await database.query.organizations.findFirst({
      where: (t, { eq }) => eq(t.id, organizationId),
      columns: {
        id: true,
        settings: true,
        trialEndsAt: true,
        createdAt: true,
      },
    });

    if (!org) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Organization not found",
      });
      return;
    }

    const settings = org.settings as any;
    const isDemo = settings?.demo === true;

    // If converting to client, remove demo flag
    if (convertToClient === true) {
      if (!isDemo) {
        res.status(status.BAD_REQUEST).json({
          success: false,
          message: "This is already a regular client account",
        });
        return;
      }

      const now = new Date();
      // Get demoCreatedAt from settings to use as joined date
      const demoCreatedAt = settings?.demoCreatedAt
        ? new Date(settings.demoCreatedAt)
        : org.createdAt || now;

      // Remove demo flag and related demo settings
      const updatedSettings = { ...settings };
      delete updatedSettings.demo;
      delete updatedSettings.demoCreatedAt;
      delete updatedSettings.demoCreatedBy;
      delete updatedSettings.demoRole;
      delete updatedSettings.passwordChanged;

      // Update organization - set proper dates
      await database
        .update(organizations)
        .set({
          settings: updatedSettings,
          createdAt: demoCreatedAt, // Set organization creation date to demo creation date
          updatedAt: now,
        })
        .where(eq(organizations.id, organizationId));

      // Update joinedAt for all users in this organization
      // Set joinedAt to demoCreatedAt (when demo was created) or organization createdAt
      const usersInOrg = await database
        .select({
          id: userOrganizations.id,
          joinedAt: userOrganizations.joinedAt,
        })
        .from(userOrganizations)
        .where(eq(userOrganizations.organizationId, organizationId));

      // Update joinedAt for users who don't have it set
      let updatedCount = 0;
      for (const userOrg of usersInOrg) {
        // Only update if joinedAt is not set
        if (!userOrg.joinedAt) {
          await database
            .update(userOrganizations)
            .set({
              joinedAt: demoCreatedAt,
              updatedAt: now,
            })
            .where(eq(userOrganizations.id, userOrg.id));
          updatedCount++;
        }
      }

      logger.info(
        `Converted demo account ${organizationId} to regular client account. Updated joined dates for ${updatedCount} of ${usersInOrg.length} users.`
      );

      res.status(status.OK).json({
        success: true,
        message: "Demo account converted to regular client successfully",
        data: {
          organizationId,
          isDemo: false,
          totalUsers: usersInOrg.length,
          updatedUsers: updatedCount,
          organizationCreatedAt: demoCreatedAt.toISOString(),
        },
      });
      return;
    }

    // If not converting, must be demo account to update trial
    if (!isDemo) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "This is not a demo account",
      });
      return;
    }

    // Update trial duration
    let newTrialEndsAt: Date | undefined;

    if (trialEndsAt) {
      // If date provided directly
      newTrialEndsAt = new Date(trialEndsAt);
      if (isNaN(newTrialEndsAt.getTime())) {
        res.status(status.BAD_REQUEST).json({
          success: false,
          message: "Invalid trial end date",
        });
        return;
      }
    } else if (trialDays !== undefined) {
      // If days provided, extend from current trial end or now
      const now = new Date();
      const currentTrialEnd = org.trialEndsAt ? new Date(org.trialEndsAt) : now;
      const baseDate = currentTrialEnd > now ? currentTrialEnd : now; // Extend from current end or now, whichever is later
      newTrialEndsAt = new Date(
        baseDate.getTime() + trialDays * 24 * 60 * 60 * 1000
      );
    } else {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Either trialEndsAt or trialDays is required",
      });
      return;
    }

    // Update organization trial end date
    await database
      .update(organizations)
      .set({
        trialEndsAt: newTrialEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organizationId));

    logger.info(
      `Updated trial duration for demo account ${organizationId} to ${newTrialEndsAt.toISOString()}`
    );

    res.status(status.OK).json({
      success: true,
      message: "Trial duration updated successfully",
      data: {
        trialEndsAt: newTrialEndsAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error updating demo account:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
