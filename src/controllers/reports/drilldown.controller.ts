import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { users, tasks, projects, timeEntries, clients, invoices, projectExpenses } from "@/schema/schema";
import { eq, and, sql, gte, lte, inArray } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { resolveDateRange } from "@/utils/dateRange.util";

// ── GET /api/reports/member/:userId/tasks ────────────────────────────────────

export const getMemberTasks = async (req: Request, res: Response) => {
  try {
    const orgId = (req.user as any)?.organizationId;
    if (!orgId) return res.status(400).json({ success: false, message: "Organization required" });

    const { userId } = req.params;
    const range = resolveDateRange(req.query as any);
    const statusFilter = (req.query as any).status as string | undefined;

    const [member] = await database
      .select({ id: users.id, name: users.name, email: users.email, image: users.image })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!member) return res.status(404).json({ success: false, message: "User not found" });

    const conditions: any[] = [
      eq(tasks.assignedTo, userId),
      eq(projects.organizationId, orgId),
      gte(tasks.createdAt, range.from),
      lte(tasks.createdAt, range.to),
    ];
    if (statusFilter) conditions.push(eq(tasks.status, statusFilter as any));

    const taskRows = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        projectName: projects.name,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        createdAt: tasks.createdAt,
        endDate: tasks.endDate,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(...conditions));

    const now = new Date();
    let completed = 0, inProgress = 0, overdue = 0;

    for (const t of taskRows) {
      if (t.status === "completed") completed++;
      else if (t.status === "in_progress") inProgress++;
      if (t.endDate && t.endDate < now && t.status !== "completed") overdue++;
    }

    const [hoursRow] = await database
      .select({ total: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)` })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), gte(timeEntries.startTime, range.from), lte(timeEntries.startTime, range.to)));

    return res.status(200).json({
      success: true,
      data: {
        member,
        tasks: taskRows.map((t) => ({ ...t, estimatedHours: Number(t.estimatedHours ?? 0), actualHours: Number(t.actualHours ?? 0) })),
        summary: {
          totalTasks: taskRows.length,
          completed,
          inProgress,
          overdue,
          totalHoursLogged: Number(((Number(hoursRow?.total ?? 0)) / 60).toFixed(1)),
        },
      },
    });
  } catch (error) {
    logger.error("getMemberTasks error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ── GET /api/reports/client/:clientId/projects ──────────────────────────────

export const getClientProjects = async (req: Request, res: Response) => {
  try {
    const orgId = (req.user as any)?.organizationId;
    if (!orgId) return res.status(400).json({ success: false, message: "Organization required" });

    const { clientId } = req.params;
    const range = resolveDateRange(req.query as any);

    const [client] = await database
      .select({ id: clients.id, name: clients.name, email: clients.email, status: clients.status })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, orgId)))
      .limit(1);

    if (!client) return res.status(404).json({ success: false, message: "Client not found" });

    const projectRows = await database
      .select({
        id: projects.id,
        name: projects.name,
        status: projects.status,
        budget: projects.budget,
        startDate: projects.startDate,
        endDate: projects.endDate,
        spent: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(projects)
      .leftJoin(projectExpenses, eq(projects.id, projectExpenses.projectId))
      .where(and(eq(projects.clientId, clientId), eq(projects.organizationId, orgId)))
      .groupBy(projects.id);

    // Task counts per project
    const projectIds = projectRows.map((p) => p.id);
    let taskCounts: any[] = [];
    if (projectIds.length > 0) {
      taskCounts = await database
        .select({
          projectId: tasks.projectId,
          total: sql<number>`COUNT(*)`,
          completed: sql<number>`COUNT(*) FILTER (WHERE ${tasks.status} = 'completed')`,
        })
        .from(tasks)
        .where(inArray(tasks.projectId, projectIds))
        .groupBy(tasks.projectId);
    }

    // Hours per project
    let hoursCounts: any[] = [];
    if (projectIds.length > 0) {
      hoursCounts = await database
        .select({
          projectId: timeEntries.projectId,
          totalMinutes: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)`,
        })
        .from(timeEntries)
        .where(and(inArray(timeEntries.projectId, projectIds), gte(timeEntries.startTime, range.from), lte(timeEntries.startTime, range.to)))
        .groupBy(timeEntries.projectId);
    }

    let totalBudget = 0, totalSpent = 0, totalHours = 0;
    let active = 0, completed = 0, delayed = 0;

    const enriched = projectRows.map((p) => {
      const tc = taskCounts.find((t) => t.projectId === p.id);
      const hc = hoursCounts.find((h) => h.projectId === p.id);
      const hours = Number(hc?.totalMinutes ?? 0) / 60;
      const budget = Number(p.budget ?? 0);
      const spent = Number(p.spent ?? 0);

      totalBudget += budget;
      totalSpent += spent;
      totalHours += hours;
      if (p.status === "active" || p.status === "ongoing") active++;
      else if (p.status === "completed") completed++;
      else if (p.status === "delayed") delayed++;

      return {
        id: p.id, name: p.name, status: p.status,
        budget, spent,
        tasksTotal: Number(tc?.total ?? 0),
        tasksCompleted: Number(tc?.completed ?? 0),
        startDate: p.startDate, endDate: p.endDate,
        hoursLogged: Number(hours.toFixed(1)),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        client,
        projects: enriched,
        summary: {
          totalProjects: projectRows.length, active, completed, delayed,
          totalBudget, totalSpent, totalHours: Number(totalHours.toFixed(1)),
        },
      },
    });
  } catch (error) {
    logger.error("getClientProjects error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// ── GET /api/reports/project/:projectId/breakdown ───────────────────────────

export const getProjectBreakdown = async (req: Request, res: Response) => {
  try {
    const orgId = (req.user as any)?.organizationId;
    if (!orgId) return res.status(400).json({ success: false, message: "Organization required" });

    const { projectId } = req.params;
    const range = resolveDateRange(req.query as any);

    const [project] = await database
      .select({ id: projects.id, name: projects.name, status: projects.status, budget: projects.budget })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.organizationId, orgId)))
      .limit(1);

    if (!project) return res.status(404).json({ success: false, message: "Project not found" });

    const taskRows = await database
      .select({
        id: tasks.id, title: tasks.title, status: tasks.status,
        assignee: users.name,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        endDate: tasks.endDate,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assignedTo, users.id))
      .where(and(eq(tasks.projectId, projectId), gte(tasks.createdAt, range.from), lte(tasks.createdAt, range.to)));

    const timeRows = await database
      .select({
        date: sql<string>`TO_CHAR(${timeEntries.startTime}, 'YYYY-MM-DD')`,
        minutes: sql<number>`COALESCE(SUM(${timeEntries.duration}), 0)`,
        userId: timeEntries.userId,
        userName: users.name,
      })
      .from(timeEntries)
      .leftJoin(users, eq(timeEntries.userId, users.id))
      .where(and(eq(timeEntries.projectId, projectId), gte(timeEntries.startTime, range.from), lte(timeEntries.startTime, range.to)))
      .groupBy(sql`TO_CHAR(${timeEntries.startTime}, 'YYYY-MM-DD')`, timeEntries.userId, users.name);

    const invoiceRows = await database
      .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, amount: invoices.amount, status: invoices.status, datepaid: invoices.datepaid })
      .from(invoices)
      .where(eq(invoices.organizationId, orgId));

    const completedTasks = taskRows.filter((t) => t.status === "completed").length;
    const totalHours = timeRows.reduce((sum, t) => sum + Number(t.minutes ?? 0), 0) / 60;
    const totalInvoiced = invoiceRows.reduce((sum, i) => sum + Number(i.amount ?? 0), 0);
    const totalPaid = invoiceRows.filter((i) => i.status === "paid").reduce((sum, i) => sum + Number(i.amount ?? 0), 0);
    const budget = Number(project.budget ?? 0);

    return res.status(200).json({
      success: true,
      data: {
        project: { ...project, budget },
        tasks: taskRows.map((t) => ({ ...t, estimatedHours: Number(t.estimatedHours ?? 0), actualHours: Number(t.actualHours ?? 0) })),
        timeEntries: timeRows.map((t) => ({ date: t.date, hours: Number((Number(t.minutes) / 60).toFixed(1)), userId: t.userId, userName: t.userName })),
        invoices: invoiceRows.map((i) => ({ ...i, amount: Number(i.amount ?? 0) })),
        summary: {
          totalTasks: taskRows.length,
          completedTasks,
          totalHours: Number(totalHours.toFixed(1)),
          budgetUsedPercent: budget > 0 ? Math.round((totalInvoiced / budget) * 100) : 0,
          totalInvoiced,
          totalPaid,
        },
      },
    });
  } catch (error) {
    logger.error("getProjectBreakdown error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
