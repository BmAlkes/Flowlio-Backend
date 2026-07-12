import { database } from "@/configs/connection.config";
import { projects, tasks, timeEntries, clientInteractions } from "@/schema/schema";
import { eq, gte, lte, and, inArray, or, count } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export interface WeeklySummaryResult {
  summary: string;
  highlights: string[];
  metrics: {
    totalProjects: number;
    activeProjects: number;
    totalTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    totalHours: number;
    billableHours: number;
  };
  projectBreakdown: Array<{
    projectName: string;
    projectNumber: string;
    status: string;
    progress: number;
    tasksCompleted: number;
    tasksInProgress: number;
    tasksPending: number;
    hoursSpent: number;
    summary: string;
  }>;
  recommendations: string[];
}

export async function checkOrgHasWeeklyActivity(
  organizationId: string,
  weekStart: Date,
  weekEnd: Date,
): Promise<boolean> {
  const projectIds = await database
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));

  if (projectIds.length === 0) return false;
  const ids = projectIds.map((p) => p.id);

  // Task activity in week
  const [taskActivity] = await database
    .select({ c: count() })
    .from(tasks)
    .where(
      and(
        inArray(tasks.projectId, ids),
        or(gte(tasks.createdAt, weekStart), gte(tasks.updatedAt, weekStart)),
      ),
    );
  if ((taskActivity?.c ?? 0) > 0) return true;

  // Time entries in week
  const [teActivity] = await database
    .select({ c: count() })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.projectId, ids),
        gte(timeEntries.startTime, weekStart),
        lte(timeEntries.startTime, weekEnd),
      ),
    );
  if ((teActivity?.c ?? 0) > 0) return true;

  // Lead interactions in week
  const [interactionActivity] = await database
    .select({ c: count() })
    .from(clientInteractions)
    .where(
      and(
        eq(clientInteractions.organizationId, organizationId),
        gte(clientInteractions.createdAt, weekStart),
      ),
    );
  return (interactionActivity?.c ?? 0) > 0;
}

export async function generateWeeklySummary(
  organizationId: string,
  weekStart: Date,
  weekEnd: Date,
  organizationName?: string,
): Promise<WeeklySummaryResult | null> {
  const organizationProjects = await database
    .select({
      id: projects.id,
      name: projects.name,
      projectNumber: projects.projectNumber,
      status: projects.status,
      progress: projects.progress,
      startDate: projects.startDate,
      endDate: projects.endDate,
      description: projects.description,
    })
    .from(projects)
    .where(eq(projects.organizationId, organizationId));

  if (organizationProjects.length === 0) return null;

  const projectIds = organizationProjects.map((p) => p.id);

  let organizationTasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string | null;
    projectId: string;
    assignedTo: string | null;
    startDate: Date | null;
    endDate: Date | null;
    estimatedHours: string | null;
    actualHours: string | null;
  }> = [];

  try {
    organizationTasks = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        projectId: tasks.projectId,
        assignedTo: tasks.assignedTo,
        startDate: tasks.startDate,
        endDate: tasks.endDate,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.projectId, projectIds),
          or(gte(tasks.createdAt, weekStart), gte(tasks.updatedAt, weekStart)),
        ),
      );
  } catch {
    organizationTasks = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        projectId: tasks.projectId,
        assignedTo: tasks.assignedTo,
        startDate: tasks.startDate,
        endDate: tasks.endDate,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
      })
      .from(tasks)
      .where(inArray(tasks.projectId, projectIds));
  }

  const organizationTimeEntries = await database
    .select({
      id: timeEntries.id,
      projectId: timeEntries.projectId,
      taskId: timeEntries.taskId,
      duration: timeEntries.duration,
      billable: timeEntries.billable,
      description: timeEntries.description,
      startTime: timeEntries.startTime,
    })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.projectId, projectIds),
        gte(timeEntries.startTime, weekStart),
        lte(timeEntries.startTime, weekEnd),
      ),
    );

  try {
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;
    if (!service) {
      logger.warn("generateWeeklySummary: OpenAI service not available, skipping");
      return null;
    }

    const result = await service.generateWeeklyProjectSummary({
      projects: organizationProjects.map((p) => ({
        id: p.id,
        name: p.name,
        projectNumber: p.projectNumber,
        status: p.status || "active",
        progress: p.progress || 0,
        startDate: p.startDate,
        endDate: p.endDate,
        description: p.description || null,
      })),
      tasks: organizationTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description || null,
        status: t.status || "todo",
        projectId: t.projectId,
        assignedTo: t.assignedTo || null,
        startDate: t.startDate,
        endDate: t.endDate,
        estimatedHours: t.estimatedHours ? parseFloat(t.estimatedHours) : null,
        actualHours: t.actualHours ? parseFloat(t.actualHours) : null,
      })),
      timeEntries: organizationTimeEntries.map((te) => ({
        projectId: te.projectId,
        taskId: te.taskId || null,
        duration: te.duration ?? 0,
        billable: te.billable ?? false,
        description: te.description || null,
      })),
      weekStart,
      weekEnd,
      organizationName,
    });

    return result;
  } catch (error) {
    logger.error("generateWeeklySummary: OpenAI call failed", error);
    return null;
  }
}
