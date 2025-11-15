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
  calendarEvents,
  auditLogs,
  recentActivities,
  projects,
  tasks,
  clients,
  invoices,
  userManagement,
  invitations,
  paymentLinks,
  projectComments,
  supportTickets,
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

    // Delete in order to respect foreign key constraints
    // IMPORTANT: Delete projects/tasks BEFORE users because projects reference users
    // Delete tables that don't have cascade first, then those with cascade

    logger.info(
      `🗑️ Starting deletion of organization ${organizationId} and all related data`
    );

    // 1. Delete calendar events (no cascade)
    await database
      .delete(calendarEvents)
      .where(eq(calendarEvents.organizationId, organizationId));
    logger.info(
      `✅ Deleted calendar events for organization ${organizationId}`
    );

    // 2. Delete audit logs (no cascade)
    await database
      .delete(auditLogs)
      .where(eq(auditLogs.organizationId, organizationId));
    logger.info(`✅ Deleted audit logs for organization ${organizationId}`);

    // 3. Delete recent activities (no cascade)
    await database
      .delete(recentActivities)
      .where(eq(recentActivities.organizationId, organizationId));
    logger.info(
      `✅ Deleted recent activities for organization ${organizationId}`
    );

    // 4. Delete notifications by organization (no cascade for organizationId)
    await database
      .delete(notifications)
      .where(eq(notifications.organizationId, organizationId));
    logger.info(`✅ Deleted notifications for organization ${organizationId}`);

    // 5. Delete project comments (cascade from projects, but delete explicitly for safety)
    // First get all project IDs for this organization
    const orgProjects = await database
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    for (const project of orgProjects) {
      await database
        .delete(projectComments)
        .where(eq(projectComments.projectId, project.id));
    }
    logger.info(
      `✅ Deleted project comments for organization ${organizationId}`
    );

    // 6. Delete tasks (cascade from projects, but delete explicitly for safety)
    for (const project of orgProjects) {
      await database.delete(tasks).where(eq(tasks.projectId, project.id));
    }
    logger.info(`✅ Deleted tasks for organization ${organizationId}`);

    // 7. Delete projects (has cascade, but delete explicitly)
    // MUST delete before users because projects.createdBy references users
    await database
      .delete(projects)
      .where(eq(projects.organizationId, organizationId));
    logger.info(`✅ Deleted projects for organization ${organizationId}`);

    // 8. Delete payment links (has cascade, but delete explicitly)
    await database
      .delete(paymentLinks)
      .where(eq(paymentLinks.organizationId, organizationId));
    logger.info(`✅ Deleted payment links for organization ${organizationId}`);

    // 9. Delete invoices (has cascade, but delete explicitly)
    await database
      .delete(invoices)
      .where(eq(invoices.organizationId, organizationId));
    logger.info(`✅ Deleted invoices for organization ${organizationId}`);

    // 10. Delete clients (has cascade, but delete explicitly)
    await database
      .delete(clients)
      .where(eq(clients.organizationId, organizationId));
    logger.info(`✅ Deleted clients for organization ${organizationId}`);

    // 11. Delete user management records (has cascade, but delete explicitly)
    await database
      .delete(userManagement)
      .where(eq(userManagement.organizationId, organizationId));
    logger.info(
      `✅ Deleted user management records for organization ${organizationId}`
    );

    // 12. Delete invitations (has cascade, but delete explicitly)
    await database
      .delete(invitations)
      .where(eq(invitations.organizationId, organizationId));
    logger.info(`✅ Deleted invitations for organization ${organizationId}`);

    // 13. Delete subscriptions
    await database
      .delete(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId));
    logger.info(`✅ Deleted subscriptions for organization ${organizationId}`);

    // 14. If it's a demo organization, get users BEFORE deleting user_organizations
    // This must be done AFTER deleting projects/tasks because they reference users
    let orgUsers: { userId: string }[] = [];
    if (isDemoOrg) {
      logger.info(
        `🗑️ Getting users for demo organization ${organizationId} before deletion`
      );

      // Get all users associated with this organization BEFORE deleting user_organizations
      orgUsers = await database
        .select({
          userId: userOrganizations.userId,
        })
        .from(userOrganizations)
        .where(eq(userOrganizations.organizationId, organizationId));
    }

    // 15. Delete user_organizations relationships
    await database
      .delete(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));
    logger.info(
      `✅ Deleted user_organizations relationships for organization ${organizationId}`
    );

    // 16. If it's a demo organization, delete associated users and their data
    if (isDemoOrg && orgUsers.length > 0) {
      logger.info(
        `🗑️ Deleting demo organization ${organizationId} with associated users`
      );

      // For each user, check if they only belong to this demo organization
      // Note: We already deleted user_organizations for this org, so if count is 0,
      // the user only belonged to this organization
      for (const orgUser of orgUsers) {
        const userOrgCount = await database
          .select()
          .from(userOrganizations)
          .where(eq(userOrganizations.userId, orgUser.userId));

        // If user doesn't belong to any other organizations, delete the user completely
        if (userOrgCount.length === 0) {
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

          // 4. Delete notifications by user
          await database
            .delete(notifications)
            .where(eq(notifications.userId, orgUser.userId));

          // 5. Delete support tickets (no cascade)
          await database
            .delete(supportTickets)
            .where(eq(supportTickets.submittedby, orgUser.userId));

          // 6. Delete the user (this will cascade to other related data)
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

    // 16. Finally, delete the organization
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
  } catch (error: any) {
    logger.error("Delete organization error:", error);
    logger.error("Error details:", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
      constraint: error?.constraint,
      detail: error?.detail,
    });
    return res.status(500).json({
      success: false,
      message: "Failed to delete organization",
      error:
        process.env.NODE_ENV === "development"
          ? {
              message: error?.message,
              code: error?.code,
              constraint: error?.constraint,
              detail: error?.detail,
            }
          : undefined,
    });
  }
};
