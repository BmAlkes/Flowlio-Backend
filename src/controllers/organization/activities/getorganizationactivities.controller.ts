import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, desc, inArray } from "drizzle-orm";
import {
  notifications,
  auditLogs,
  users,
  userOrganizations,
  recentActivities,
} from "@/schema/schema";
import status from "http-status";

export const getOrganizationActivities = async (
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

    // Prefer organizationId from authenticated context
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

    // Prefer recentActivities (first-class activity feed)
    const recent = await database
      .select()
      .from(recentActivities)
      .where(eq(recentActivities.organizationId, organizationId))
      .orderBy(desc(recentActivities.createdAt))
      .limit(20);

    // Get user names for recent activities
    const userIds = new Set<string>();
    recent.forEach((r) => {
      if (r.actorId) userIds.add(r.actorId);
    });
    const userMap = new Map<string, { name: string; image: string | null }>();
    if (userIds.size > 0) {
      const list = await database
        .select({ id: users.id, name: users.name, image: users.image })
        .from(users)
        .where(inArray(users.id, Array.from(userIds)));
      list.forEach((u) =>
        userMap.set(u.id, { name: u.name || "Unknown", image: u.image })
      );
    }

    let activities = recent.map((r) => {
      const createdAt =
        r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      return {
        id: r.id,
        type: r.type,
        source: "recent", // Indicates this came from recentActivities table
        user: r.actorId ? userMap.get(r.actorId)?.name || "System" : "System",
        userImage: r.actorId ? userMap.get(r.actorId)?.image || null : null,
        activity: r.message || `${r.action} ${r.resource}`,
        date: createdAt,
        timestamp: createdAt.getTime(),
      };
    });

    // Fallback to auditLogs/notifications if recentActivities is empty
    if (activities.length === 0) {
      // Fetch audit logs for the organization (more detailed activity tracking)
      const orgAuditLogsRaw = await database
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.organizationId, organizationId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(50);

      const orgNotificationsRaw = await database
        .select()
        .from(notifications)
        .where(eq(notifications.organizationId, organizationId))
        .orderBy(desc(notifications.createdAt))
        .limit(50);

      const ids = new Set<string>();
      orgAuditLogsRaw.forEach((log) => log.userId && ids.add(log.userId));
      orgNotificationsRaw.forEach((n) => ids.add(n.userId));

      const names = new Map<string, { name: string; image: string | null }>();
      if (ids.size > 0) {
        const list = await database
          .select({ id: users.id, name: users.name, image: users.image })
          .from(users)
          .where(inArray(users.id, Array.from(ids)));
        list.forEach((u) =>
          names.set(u.id, { name: u.name || "Unknown", image: u.image })
        );
      }

      activities = [
        ...orgAuditLogsRaw.map((log) => ({
          id: log.id,
          type: "audit",
          source: "audit", // Indicates this came from auditLogs table
          user: log.userId ? names.get(log.userId)?.name || "System" : "System",
          userImage: log.userId ? names.get(log.userId)?.image || null : null,
          activity: formatAuditActivity(log),
          date: log.createdAt,
          timestamp: new Date(log.createdAt).getTime(),
        })),
        ...orgNotificationsRaw.map((notif) => ({
          id: notif.id,
          type: "notification",
          source: "notification", // Indicates this came from notifications table
          user: names.get(notif.userId)?.name || "System",
          userImage: names.get(notif.userId)?.image || null,
          activity: notif.message,
          date: notif.createdAt,
          timestamp: new Date(notif.createdAt).getTime(),
        })),
      ]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 20);
    }

    logger.info(
      `Retrieved ${activities.length} activities for organization ${organizationId}`
    );

    res.status(status.OK).json({
      success: true,
      message: "Organization activities retrieved successfully",
      data: {
        activities,
      },
    });
  } catch (error) {
    logger.error("Error retrieving organization activities:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve organization activities",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

function formatAuditActivity(log: any): string {
  const action = log.action || "performed";
  const resource = log.resource || "item";
  switch (action) {
    case "create":
      return `created a new ${resource}`;
    case "update":
      return `updated ${resource}`;
    case "delete":
      return `deleted ${resource}`;
    case "assign":
      return `assigned ${resource}`;
    default:
      return `${action} ${resource}`;
  }
}
