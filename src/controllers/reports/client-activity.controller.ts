import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { clients, projects, tasks, timeEntries } from "@/schema/schema";
import { eq, sql, and, inArray, gte, lte } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { resolveDateRange, previousRange, pctChange } from "@/utils/dateRange.util";

export const getClientActivityReport = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.user as any;
    if (!organizationId) return res.status(400).json({ success: false, message: "Organization ID is required" });

    const range = resolveDateRange(req.query as any);
    const prev = previousRange(range);

    // Count new clients created in current and previous period for comparison
    const [curClientsCreated, prevClientsCreated] = await Promise.all([
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(clients)
        .where(and(eq(clients.organizationId, organizationId), eq(clients.clientType, "client"), gte(clients.createdAt, range.from), lte(clients.createdAt, range.to))),
      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(clients)
        .where(and(eq(clients.organizationId, organizationId), eq(clients.clientType, "client"), gte(clients.createdAt, prev.from), lte(clients.createdAt, prev.to))),
    ]);

    const orgClients = await database
      .select({ id: clients.id, name: clients.name, email: clients.email, status: clients.status, industry: clients.businessIndustry, image: clients.image })
      .from(clients)
      .where(eq(clients.organizationId, organizationId));

    if (!orgClients.length) {
      return res.status(200).json({
        success: true,
        data: { clientStats: [], statusDistribution: [], projectStatusSummary: [], period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] }, updatedAt: new Date().toISOString(), totals: { totalClients: 0, totalProjects: 0, totalHoursTracked: 0, avgActivityScore: 0 } },
      });
    }

    const clientIds = orgClients.map((c) => c.id);

    const projectStats = await database
      .select({ clientId: projects.clientId, status: projects.status, count: sql<number>`COUNT(${projects.id})` })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), inArray(projects.clientId, clientIds)))
      .groupBy(projects.clientId, projects.status);

    const taskStats = await database
      .select({
        clientId: projects.clientId,
        totalTasks: sql<number>`COUNT(${tasks.id})`,
        completedTasks: sql<number>`SUM(CASE WHEN ${tasks.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(projects.organizationId, organizationId), inArray(projects.clientId, clientIds), gte(tasks.createdAt, range.from), lte(tasks.createdAt, range.to)))
      .groupBy(projects.clientId);

    const hoursStats = await database
      .select({
        clientId: sql<string>`COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
        totalMinutes: sql<number>`SUM(CASE WHEN ${timeEntries.status} = 'active' THEN EXTRACT(EPOCH FROM (NOW() - ${timeEntries.startTime})) / 60 ELSE COALESCE(${timeEntries.duration}, 0) END)`,
        activeSessionCount: sql<number>`SUM(CASE WHEN ${timeEntries.status} = 'active' OR (${timeEntries.description} = 'Portal Activity' AND ${timeEntries.updatedAt} >= NOW() - INTERVAL '5 minutes') THEN 1 ELSE 0 END)`,
      })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(and(
        inArray(sql<string>`COALESCE(${timeEntries.clientId}, ${projects.clientId})`, clientIds),
        gte(timeEntries.startTime, range.from),
        lte(timeEntries.startTime, range.to),
      ))
      .groupBy(sql`COALESCE(${timeEntries.clientId}, ${projects.clientId})`);

    let totalActivityScore = 0;
    let totalHoursTracked = 0;
    let totalProjectCount = 0;

    const clientStats = orgClients.map((client) => {
      const clientProjects = projectStats.filter((p) => p.clientId === client.id);
      const taskData = taskStats.find((t) => t.clientId === client.id);
      const hoursData = hoursStats.find((h) => h.clientId === client.id);

      const projectCounts = { active: 0, completed: 0, delayed: 0, pending: 0, total: 0 };
      clientProjects.forEach((p) => {
        const count = Number(p.count);
        projectCounts.total += count;
        if (p.status === "active" || p.status === "ongoing") projectCounts.active += count;
        else if (p.status === "completed") projectCounts.completed += count;
        else if (p.status === "delayed") projectCounts.delayed += count;
        else projectCounts.pending += count;
      });

      const rawMinutes = Number(hoursData?.totalMinutes ?? 0);
      const isOnline = Number(hoursData?.activeSessionCount ?? 0) > 0;
      if (isOnline && projectCounts.active === 0) projectCounts.active = 1;

      const activityScore = projectCounts.total > 0
        ? Math.min(Math.round(projectCounts.active * 30 + projectCounts.completed * 20 + Number(taskData?.completedTasks ?? 0) * 5 + rawMinutes / 60), 100)
        : 0;

      totalActivityScore += activityScore;
      totalHoursTracked += rawMinutes / 60;
      totalProjectCount += projectCounts.total;

      return {
        client: { id: client.id, name: client.name, email: client.email, status: client.status, industry: client.industry, image: client.image, isOnline },
        projects: projectCounts,
        tasks: { total: Number(taskData?.totalTasks ?? 0), completed: Number(taskData?.completedTasks ?? 0) },
        timeTracked: { hours: Math.floor(rawMinutes / 60), minutes: Math.round(rawMinutes % 60), totalMinutes: Math.round(rawMinutes) },
        hoursTracked: Number((rawMinutes / 60).toFixed(1)),
        activityScore,
      };
    });

    clientStats.sort((a, b) => b.projects.total - a.projects.total);

    const statusMap: Record<string, number> = {};
    projectStats.forEach((p) => { statusMap[p.status ?? "unknown"] = (statusMap[p.status ?? "unknown"] ?? 0) + Number(p.count); });
    const projectStatusSummary = Object.entries(statusMap).map(([status, count]) => ({ status, count }));

    const clientStatusMap: Record<string, number> = {};
    orgClients.forEach((c) => { clientStatusMap[c.status ?? "Unknown"] = (clientStatusMap[c.status ?? "Unknown"] ?? 0) + 1; });
    const statusDistribution = Object.entries(clientStatusMap).map(([status, count]) => ({ status, count }));

    const currentNew = Number(curClientsCreated[0]?.count ?? 0);
    const previousNew = Number(prevClientsCreated[0]?.count ?? 0);

    return res.status(200).json({
      success: true,
      data: {
        clientStats,
        statusDistribution,
        projectStatusSummary,
        period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] },
        updatedAt: new Date().toISOString(),
        comparison: {
          newClientsThisPeriod: currentNew,
          newClientsPreviousPeriod: previousNew,
          clientChange: pctChange(currentNew, previousNew),
        },
        totals: {
          totalClients: orgClients.length,
          totalProjects: totalProjectCount,
          totalHoursTracked: Number(totalHoursTracked.toFixed(1)),
          avgActivityScore: orgClients.length > 0 ? Math.round(totalActivityScore / orgClients.length) : 0,
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching client activity report:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
