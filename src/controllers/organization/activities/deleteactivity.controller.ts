import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and } from "drizzle-orm";
import {
  recentActivities,
  auditLogs,
  notifications,
  userOrganizations,
} from "@/schema/schema";
import status from "http-status";

export const deleteActivity = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id } = req.params;
    const { type } = req.query; // 'recent' | 'audit' | 'notification'

    if (!id) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Activity ID is required",
      });
      return;
    }

    // Get organizationId (same logic as get controller)
    let organizationId = (req.user as any)?.organizationId as
      | string
      | undefined;

    if (!organizationId) {
      // Fallback: fetch from userOrganizations mapping table
      const userOrg = await database
        .select({ organizationId: userOrganizations.organizationId })
        .from(userOrganizations)
        .where(eq(userOrganizations.userId, user.id))
        .limit(1);

      if (!userOrg.length || !userOrg[0].organizationId) {
        res.status(status.BAD_REQUEST).json({
          success: false,
          message: "User does not belong to an organization",
        });
        return;
      }

      organizationId = userOrg[0].organizationId;
    }

    logger.info(
      `Attempting to delete activity ${id} for organization ${organizationId}, type: ${
        type || "not specified"
      }`
    );

    let deleted = false;

    // Always try recentActivities first (primary activity source)
    // The type field in activities from recentActivities is the activity type (auth, user, task, etc.)
    // not "recent", so we check recentActivities regardless of type parameter
    if (!type || (type !== "audit" && type !== "notification")) {
      try {
        const result = await database
          .delete(recentActivities)
          .where(
            and(
              eq(recentActivities.id, id),
              eq(recentActivities.organizationId, organizationId)
            )
          )
          .returning();

        if (result.length > 0) {
          deleted = true;
          logger.info(
            `Deleted recent activity ${id} for organization ${organizationId}`
          );
        }
      } catch (error) {
        logger.error(`Error deleting from recentActivities: ${error}`);
      }
    }

    // If not found in recentActivities and type is 'audit' or not specified, try auditLogs
    if (!deleted && (!type || type === "audit")) {
      try {
        const result = await database
          .delete(auditLogs)
          .where(
            and(
              eq(auditLogs.id, id),
              eq(auditLogs.organizationId, organizationId)
            )
          )
          .returning();

        if (result.length > 0) {
          deleted = true;
          logger.info(
            `Deleted audit log ${id} for organization ${organizationId}`
          );
        }
      } catch (error) {
        logger.error(`Error deleting from auditLogs: ${error}`);
      }
    }

    // If not found in auditLogs and type is 'notification' or not specified, try notifications
    if (!deleted && (!type || type === "notification")) {
      try {
        const result = await database
          .delete(notifications)
          .where(
            and(
              eq(notifications.id, id),
              eq(notifications.organizationId, organizationId)
            )
          )
          .returning();

        if (result.length > 0) {
          deleted = true;
          logger.info(
            `Deleted notification ${id} for organization ${organizationId}`
          );
        }
      } catch (error) {
        logger.error(`Error deleting from notifications: ${error}`);
      }
    }

    // If still not found, log for debugging
    if (!deleted) {
      logger.warn(
        `Failed to delete activity ${id} for organization ${organizationId}. Type: ${
          type || "not specified"
        }. Checked all tables.`
      );
    }

    if (!deleted) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Activity not found or you don't have permission to delete it",
      });
      return;
    }

    res.status(status.OK).json({
      success: true,
      message: "Activity deleted successfully",
      data: { id },
    });
  } catch (error) {
    logger.error("Error deleting activity:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete activity",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
