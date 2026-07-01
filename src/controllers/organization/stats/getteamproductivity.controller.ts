import { database } from "@/configs/connection.config";
import { timeEntries, projects, tasks, users, userOrganizations } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq, and, inArray, gte, lte } from "drizzle-orm";
import { resolveDateRange } from "@/utils/dateRange.util";

export const getTeamProductivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization ID is required" });
      return;
    }

    const range = resolveDateRange(req.query as any);

    const orgUserIdsResult = await database
      .select({ userId: userOrganizations.userId })
      .from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));

    const userIds = orgUserIdsResult.map((u) => u.userId);

    if (userIds.length === 0) {
      res.status(200).json({
        success: true,
        data: [],
        period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] },
        updatedAt: new Date().toISOString(),
        totals: { totalMembers: 0, totalTasks: 0, totalCompletedTasks: 0, totalMinutes: 0, avgCompletionRate: 0 },
      });
      return;
    }

    const hoursResult = await database
      .select({ userId: timeEntries.userId, totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)` })
      .from(timeEntries)
      .where(and(inArray(timeEntries.userId, userIds), gte(timeEntries.startTime, range.from), lte(timeEntries.startTime, range.to)))
      .groupBy(timeEntries.userId);

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
      .where(and(inArray(tasks.assignedTo, userIds), eq(projects.organizationId, organizationId), gte(tasks.createdAt, range.from), lte(tasks.createdAt, range.to)))
      .groupBy(tasks.assignedTo);

    const userDetails = await database
      .select({ id: users.id, name: users.name, image: users.image })
      .from(users)
      .where(inArray(users.id, userIds));

    // Capacity: 8h/day × working days in range (approx 5/7 of calendar days)
    const rangeDays = Math.max(1, (range.to.getTime() - range.from.getTime()) / 86_400_000);
    const workingDays = Math.round(rangeDays * (5 / 7));
    const capacityMinutes = workingDays * 8 * 60; // 480 min/day

    let totalTasks = 0, totalCompleted = 0, totalMinutes = 0;

    const productivityData = userDetails.map((user) => {
      const minutes = Number(hoursResult.find((h) => h.userId === user.id)?.totalMinutes ?? 0);
      const tStats = tasksResult.find((t) => t.userId === user.id);
      const ut = Number(tStats?.totalTasks ?? 0);
      const uc = Number(tStats?.completedTasks ?? 0);

      totalTasks += ut;
      totalCompleted += uc;
      totalMinutes += minutes;

      return {
        userId: user.id,
        userName: user.name,
        userImage: user.image,
        totalMinutes: minutes,
        totalTasks: ut,
        completedTasks: uc,
        inProgressTasks: Number(tStats?.inProgressTasks ?? 0),
        pendingTasks: Number(tStats?.pendingTasks ?? 0),
        workload: {
          minutesLogged: minutes,
          capacityMinutes,
          utilizationPct: capacityMinutes > 0 ? Math.min(Math.round((minutes / capacityMinutes) * 100), 999) : 0,
        },
      };
    });

    res.status(200).json({
      success: true,
      data: productivityData,
      period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] },
      updatedAt: new Date().toISOString(),
      totals: {
        totalMembers: userIds.length,
        totalTasks,
        totalCompletedTasks: totalCompleted,
        totalMinutes,
        avgCompletionRate: totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0,
      },
    });
  } catch (error) {
    logger.error("Error fetching team productivity:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
