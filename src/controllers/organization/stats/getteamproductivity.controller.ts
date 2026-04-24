import { database } from "@/configs/connection.config";
import { timeEntries, projects, tasks, users, userOrganizations } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq, and, inArray } from "drizzle-orm";
import status from "http-status";

export const getTeamProductivity = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getTeamProductivity called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
       res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // 1. Get all users in this organization
    const orgUserIdsResult = await database
      .select({ userId: userOrganizations.userId })
      .from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));

    const userIds = orgUserIdsResult.map((u) => u.userId);

    if (userIds.length === 0) {
       res.status(200).json({
        success: true,
        data: [],
      });
      return;
    }

    // 2. Aggregate hours/minutes tracked per user
    const hoursResult = await database
      .select({
        userId: timeEntries.userId,
        totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)`,
      })
      .from(timeEntries)
      .where(inArray(timeEntries.userId, userIds))
      .groupBy(timeEntries.userId);

    // 3. Aggregate tasks per user (Total, Completed, In Progress, Pending)
    const tasksResult = await database
      .select({
        userId: tasks.assignedTo,
        totalTasks: sql<number>`COUNT(*)`,
        completedTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        inProgressTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'in_progress')`,
        pendingTasks: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} IN ('todo', 'updated', 'delay', 'changes'))`,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(
        inArray(tasks.assignedTo, userIds),
        eq(projects.organizationId, organizationId)
      ))
      .groupBy(tasks.assignedTo);

    // 4. Get user details for these users
    const userDetails = await database
      .select({
        id: users.id,
        name: users.name,
        image: users.image,
      })
      .from(users)
      .where(inArray(users.id, userIds));

    // 5. Merge data
    const productivityData = userDetails.map((user) => {
      const minutes = hoursResult.find((h) => h.userId === user.id)?.totalMinutes || 0;
      const tStats = tasksResult.find((t) => t.userId === user.id);
      
      return {
        userId: user.id,
        userName: user.name,
        userImage: user.image,
        totalMinutes: Number(minutes),
        totalTasks: Number(tStats?.totalTasks || 0),
        completedTasks: Number(tStats?.completedTasks || 0),
        inProgressTasks: Number(tStats?.inProgressTasks || 0),
        pendingTasks: Number(tStats?.pendingTasks || 0),
      };
    });

    logger.info(`✅ Team productivity fetched for organization ${organizationId}`);

    res.status(200).json({
      success: true,
      message: "Team productivity fetched successfully",
      data: productivityData,
    });
  } catch (error) {
    logger.error("Error fetching team productivity:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
