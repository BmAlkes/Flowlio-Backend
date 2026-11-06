import { projectReadScope } from "@/security/resource-access";
import { database } from "@/configs/connection.config";
import { projects, tasks } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql } from "drizzle-orm";
import status from "http-status";

export const getProjectScheduleData = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getProjectScheduleData called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Optional period: a task belongs to it when it was open at some point in the period
    // (started before it ended) or was completed during it. Without a period every task counts.
    const from = req.query.from === undefined ? null : new Date(String(req.query.from));
    const to = req.query.to === undefined ? null : new Date(String(req.query.to));
    if ((from === null) !== (to === null) || (from && isNaN(from.getTime())) || (to && isNaN(to.getTime())) || (from && to && from > to)) {
      res.status(400).json({ success: false, message: "Use both from and to as valid dates, with from before to" });
      return;
    }
    const inPeriod = from && to
      ? sql` and coalesce(${tasks.startDate}, ${tasks.createdAt}) <= ${to} and (${tasks.status} is distinct from 'completed' or coalesce(${tasks.updatedAt}, ${tasks.createdAt}) >= ${from})`
      : sql``;

    const projectsWithTaskCounts = await database
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        status: projects.status,
        createdAt: projects.createdAt, // Include creation date for frontend filtering
        completedTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} = 'completed' THEN 1 END)`,
        inProgressTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} IN ('in_progress', 'todo', 'updated') THEN 1 END)`,
        delayedTasks: sql<number>`COUNT(CASE WHEN ${tasks.status} IN ('delay', 'changes') THEN 1 END)`,
        totalTasks: sql<number>`COUNT(${tasks.id})`,
      })
      .from(projects)
      .leftJoin(tasks, sql`${tasks.projectId} = ${projects.id}${inPeriod}`)
      .where(projectReadScope(req.user!))
      .groupBy(
        projects.id,
        projects.name,
        projects.projectNumber,
        projects.status,
        projects.createdAt
      )
      .having(from ? sql`count(${tasks.id}) > 0` : undefined)
      .orderBy(projects.createdAt);

    logger.info(
      `✅ Fetched ${projectsWithTaskCounts.length} projects with task counts for organization ${organizationId}`
    );

    res.status(200).json({
      success: true,
      message: "Project schedule data fetched successfully",
      data: projectsWithTaskCounts,
    });
  } catch (error) {
    logger.error("Error fetching project schedule data:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
