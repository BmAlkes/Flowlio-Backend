import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  organizations,
  userOrganizations,
  subscriptions,
  users,
  account,
  session,
  timeEntries,
  notifications,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const deleteOrganization = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

    // Check if organization exists and if it's a demo organization
    const [organization] = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // Check if this is a demo organization
    const isDemoOrg =
      (organization.settings as any)?.demo === true ||
      organization.name?.toLowerCase().includes("demo");

    // If it's a demo organization, delete associated users and their data
    if (isDemoOrg) {
      logger.info(
        `🗑️ Deleting demo organization ${organizationId} with associated users`
      );

      // Get all users associated with this organization
      const orgUsers = await database
        .select({
          userId: userOrganizations.userId,
        })
        .from(userOrganizations)
        .where(eq(userOrganizations.organizationId, organizationId));

      // For each user, check if they only belong to this demo organization
      for (const orgUser of orgUsers) {
        const userOrgCount = await database
          .select()
          .from(userOrganizations)
          .where(eq(userOrganizations.userId, orgUser.userId));

        // If user only belongs to this organization, delete the user completely
        if (userOrgCount.length === 1) {
          logger.info(
            `🗑️ Deleting demo user ${orgUser.userId} (only belongs to demo org)`
          );

          // Delete user-related data (these should cascade, but doing explicitly for safety)
          // 1. Delete sessions
          await database
            .delete(session)
            .where(eq(session.userId, orgUser.userId));

          // 2. Delete account records (Better Auth authentication records)
          await database
            .delete(account)
            .where(eq(account.userId, orgUser.userId));

          // 3. Delete time entries
          await database
            .delete(timeEntries)
            .where(eq(timeEntries.userId, orgUser.userId));

          // 4. Delete notifications
          await database
            .delete(notifications)
            .where(eq(notifications.userId, orgUser.userId));

          // 5. Delete the user (this will cascade to other related data)
          await database.delete(users).where(eq(users.id, orgUser.userId));

          logger.info(
            `✅ Deleted demo user ${orgUser.userId} and all associated data`
          );
        } else {
          logger.info(
            `⏭️ Skipping user ${orgUser.userId} (belongs to ${userOrgCount.length} organizations)`
          );
        }
      }
    }

    // Delete in order: subscriptions -> user_organizations -> organization
    // This ensures foreign key constraints are respected

    // 1. Delete subscriptions
    await database
      .delete(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId));

    // 2. Delete user_organizations relationships
    await database
      .delete(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));

    // 3. Delete the organization
    await database
      .delete(organizations)
      .where(eq(organizations.id, organizationId));

    logger.info(`✅ Organization ${organizationId} deleted successfully`);

    return res.status(200).json({
      success: true,
      message: "Organization deleted successfully",
      data: {
        organizationId,
        deletedAt: new Date().toISOString(),
        isDemoOrg,
      },
    });
  } catch (error) {
    logger.error("Delete organization error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete organization",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
