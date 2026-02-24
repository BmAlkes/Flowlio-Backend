import { database } from "@/configs/connection.config";
import {
  users,
  account,
  session,
  userOrganizations,
  notifications,
  timeEntries,
  calendarEvents,
  tasks,
  projects,
  supportTickets,
  invitations,
  paymentLinks,
  recentActivities,
  invoices,
  clients,
  userManagement,
  subadmin,
} from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";
import { eq, or } from "drizzle-orm";

export const deleteUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: "User ID is required",
      });
      return;
    }

    logger.info(`🗑️ Super admin deleting user: ${userId}`);

    // Check if user exists
    const userToDelete = await database
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (userToDelete.length === 0) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    const user = userToDelete[0];

    // Prevent deletion of super admin
    if (user.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: "Cannot delete super admin user",
      });
      return;
    }

    // Prevent deletion of current user
    if (req.user && req.user.id === userId) {
      res.status(403).json({
        success: false,
        message: "You cannot delete your own account",
      });
      return;
    }

    // Delete user in transaction to ensure all related data is deleted
    await database.transaction(async (tx) => {
      // Note: Most of these will be cascade deleted, but we log them for clarity
      // 1. Delete sessions (cascade)
      await tx.delete(session).where(eq(session.userId, userId));
      logger.info(`✅ Deleted sessions for user ${userId}`);

      // 2. Delete account records (cascade)
      await tx.delete(account).where(eq(account.userId, userId));
      logger.info(`✅ Deleted account records for user ${userId}`);

      // 3. Delete notifications (cascade)
      await tx.delete(notifications).where(eq(notifications.userId, userId));
      logger.info(`✅ Deleted notifications for user ${userId}`);

      // 4. Delete time entries (cascade)
      await tx.delete(timeEntries).where(eq(timeEntries.userId, userId));
      logger.info(`✅ Deleted time entries for user ${userId}`);

      // 5. Delete calendar events (cascade)
      await tx.delete(calendarEvents).where(eq(calendarEvents.userId, userId));
      logger.info(`✅ Deleted calendar events for user ${userId}`);

      // 6. Delete tasks created by user (cascade)
      await tx.delete(tasks).where(eq(tasks.createdBy, userId));
      logger.info(`✅ Deleted tasks created by user ${userId}`);

      // 7. Delete projects created by user (cascade)
      await tx.delete(projects).where(eq(projects.createdBy, userId));
      logger.info(`✅ Deleted projects created by user ${userId}`);

      // 8. Delete support tickets submitted by user
      await tx
        .delete(supportTickets)
        .where(eq(supportTickets.submittedby, userId));
      logger.info(`✅ Deleted support tickets for user ${userId}`);

      // 9. Delete invitations sent by user
      await tx.delete(invitations).where(eq(invitations.invitedBy, userId));
      logger.info(`✅ Deleted invitations sent by user ${userId}`);

      // 10. Delete payment links created by user
      await tx.delete(paymentLinks).where(eq(paymentLinks.createdBy, userId));
      logger.info(`✅ Deleted payment links created by user ${userId}`);

      // 11. Delete invoices created by user
      await tx.delete(invoices).where(eq(invoices.createdBy, userId));
      logger.info(`✅ Deleted invoices created by user ${userId}`);

      // 12. Delete clients created by user
      await tx.delete(clients).where(eq(clients.createdBy, userId));
      logger.info(`✅ Deleted clients created by user ${userId}`);

      // 13. Delete user management records created by user
      await tx
        .delete(userManagement)
        .where(eq(userManagement.createdBy, userId));
      logger.info(
        `✅ Deleted user management records created by user ${userId}`,
      );

      // 14. Update subadmin records where user is the creator (set to null)
      // Note: subadmin.createdBy has onDelete: "set null", but we'll handle it explicitly
      await tx
        .update(subadmin)
        .set({ createdBy: null })
        .where(eq(subadmin.createdBy, userId));
      logger.info(`✅ Updated subadmin records for user ${userId}`);

      // 15. Delete recent activities where user is the actor or subject
      await tx
        .delete(recentActivities)
        .where(
          or(
            eq(recentActivities.actorId, userId),
            eq(recentActivities.userId, userId),
          ),
        );
      logger.info(`✅ Deleted recent activities for user ${userId}`);

      // 16. Delete user-organizations relationships (cascade)
      await tx
        .delete(userOrganizations)
        .where(eq(userOrganizations.userId, userId));
      logger.info(`✅ Deleted user-organizations for user ${userId}`);

      // 17. Delete the user (this will cascade to any remaining related data)
      await tx.delete(users).where(eq(users.id, userId));
      logger.info(`✅ Deleted user ${userId} and all associated data`);
    });

    logger.info(`✅ Successfully deleted user: ${user.email} (${userId})`);

    res.status(200).json({
      success: true,
      message: "User deleted successfully",
      data: {
        deletedUser: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      },
    });
  } catch (error) {
    logger.error("Error deleting user:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
