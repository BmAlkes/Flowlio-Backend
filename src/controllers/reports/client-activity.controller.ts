import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { clients, projects, tasks, timeEntries } from "@/schema/schema";
import { eq, sql, and, inArray } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const getClientActivityReport = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.user as any;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

    // 1. Get all clients in this organization
    const orgClients = await database
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        status: clients.status,
        industry: clients.businessIndustry,
        image: clients.image,
      })
      .from(clients)
      .where(eq(clients.organizationId, organizationId));

    if (!orgClients.length) {
      return res.status(200).json({
        success: true,
        data: {
          clientStats: [],
          statusDistribution: [],
          projectStatusSummary: [],
        },
      });
    }

    const clientIds = orgClients.map((c) => c.id);

    // 2. Aggregate project counts per client, grouped by project status
    const projectStats = await database
      .select({
        clientId: projects.clientId,
        status: projects.status,
        count: sql<number>`COUNT(${projects.id})`,
      })
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          inArray(projects.clientId, clientIds),
        ),
      )
      .groupBy(projects.clientId, projects.status);

    // 3. Aggregate total tasks per client via projects
    const taskStats = await database
      .select({
        clientId: projects.clientId,
        totalTasks: sql<number>`COUNT(${tasks.id})`,
        completedTasks: sql<number>`SUM(CASE WHEN ${tasks.status} = 'completed' THEN 1 ELSE 0 END)`,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          inArray(projects.clientId, clientIds),
        ),
      )
      .groupBy(projects.clientId);

    // 4. Aggregate hours tracked and current activity status per client
    const hoursStats = await database
      .select({
        clientId: sql<string>`COALESCE(${timeEntries.clientId}, ${projects.clientId})`,
        totalMinutes: sql<number>`SUM(
          CASE 
            WHEN ${timeEntries.status} = 'active' THEN EXTRACT(EPOCH FROM (NOW() - ${timeEntries.startTime})) / 60
            ELSE COALESCE(${timeEntries.duration}, 0)
          END
        )`,
        // Count as "currently active" if they have an 'active' status timer 
        // OR a 'Portal Activity' ping within the last 5 minutes
        activeSessionCount: sql<number>`SUM(
          CASE 
            WHEN ${timeEntries.status} = 'active' OR 
                 (${timeEntries.description} = 'Portal Activity' AND ${timeEntries.updatedAt} >= NOW() - INTERVAL '5 minutes')
            THEN 1 ELSE 0 END
        )`,
      })
      .from(timeEntries)
      .leftJoin(projects, eq(timeEntries.projectId, projects.id))
      .where(
        inArray(sql<string>`COALESCE(${timeEntries.clientId}, ${projects.clientId})`, clientIds)
      )
      .groupBy(sql`COALESCE(${timeEntries.clientId}, ${projects.clientId})`);

    // 5. Build client stats by merging all data
    const clientStats = orgClients.map((client) => {
      const clientProjects = projectStats.filter(
        (p) => p.clientId === client.id,
      );
      const taskData = taskStats.find((t) => t.clientId === client.id);
      const hoursData = hoursStats.find((h) => h.clientId === client.id);

      const projectCounts = {
        active: 0,
        completed: 0,
        delayed: 0,
        pending: 0,
        total: 0,
      };

      clientProjects.forEach((p) => {
        const count = Number(p.count);
        projectCounts.total += count;
        if (p.status === "active" || p.status === "ongoing")
          projectCounts.active += count;
        else if (p.status === "completed") projectCounts.completed += count;
        else if (p.status === "delayed") projectCounts.delayed += count;
        else projectCounts.pending += count;
      });

      const rawMinutes = Number(hoursData?.totalMinutes ?? 0);
      const trackedHours = Math.floor(rawMinutes / 60);
      const trackedMinutes = Math.round(rawMinutes % 60);
      const isOnline = Number(hoursData?.activeSessionCount ?? 0) > 0;

      // If they are online but have 0 active projects, we can show them as active
      // or just return the isOnline flag for the frontend to use.
      // The user wants "Active" column to not be 0.
      if (isOnline && projectCounts.active === 0) {
        // We could increment it, but it might be misleading if it's about projects.
        // However, the user specifically asked to "fix it [0 in active] according to logged in time".
        projectCounts.active = 1; 
      }

      return {
        client: {
          id: client.id,
          name: client.name,
          email: client.email,
          status: client.status,
          industry: client.industry,
          image: client.image,
          isOnline: isOnline, // Added isOnline flag
        },
        projects: projectCounts,
        tasks: {
          total: Number(taskData?.totalTasks ?? 0),
          completed: Number(taskData?.completedTasks ?? 0),
        },
        timeTracked: {
          hours: trackedHours,
          minutes: trackedMinutes,
          totalMinutes: Math.round(rawMinutes),
        },
        // Kept for backwards-compatibility — rounded to 1 decimal hour
        hoursTracked: Number((rawMinutes / 60).toFixed(1)),
        activityScore:
          projectCounts.total > 0
            ? Math.min(
                Math.round(
                  projectCounts.active * 30 +
                    projectCounts.completed * 20 +
                    Number(taskData?.completedTasks ?? 0) * 5 +
                    rawMinutes / 60,
                ),
                100,
              )
            : 0,
      };
    });

    // Sort by total projects descending
    clientStats.sort((a, b) => b.projects.total - a.projects.total);

    // 6. Build overall project status distribution across all clients
    const statusMap: Record<string, number> = {};
    projectStats.forEach((p) => {
      const s = p.status ?? "unknown";
      statusMap[s] = (statusMap[s] ?? 0) + Number(p.count);
    });
    const projectStatusSummary = Object.entries(statusMap).map(
      ([status, count]) => ({
        status,
        count,
      }),
    );

    // 7. Client status distribution
    const clientStatusMap: Record<string, number> = {};
    orgClients.forEach((c) => {
      const s = c.status ?? "Unknown";
      clientStatusMap[s] = (clientStatusMap[s] ?? 0) + 1;
    });
    const statusDistribution = Object.entries(clientStatusMap).map(
      ([status, count]) => ({ status, count }),
    );

    return res.status(200).json({
      success: true,
      data: {
        clientStats,
        statusDistribution,
        projectStatusSummary,
      },
    });
  } catch (error) {
    logger.error("Error fetching client activity report:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
