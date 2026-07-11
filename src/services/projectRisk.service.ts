import { database } from "@/configs/connection.config";
import { projects, tasks, timeEntries } from "@/schema/schema";
import { eq, inArray } from "drizzle-orm";

export interface ProjectRiskResult {
  projectId: string;
  projectName: string;
  projectNumber: string;
  organizationId: string;
  assignedTo: string | null;
  riskScore: number;
  delayRisk: number;
  budgetRisk: number;
  reasons: string[];
}

export async function computeHighRiskProjects(
  organizationId: string,
): Promise<ProjectRiskResult[]> {
  const now = new Date();

  const allProjects = await database
    .select()
    .from(projects)
    .where(eq(projects.organizationId, organizationId));

  if (allProjects.length === 0) return [];

  const projectIds = allProjects.map((p) => p.id);

  const allTasks = await database
    .select()
    .from(tasks)
    .where(inArray(tasks.projectId, projectIds));

  const allTimeEntries = await database
    .select()
    .from(timeEntries)
    .where(inArray(timeEntries.projectId, projectIds));

  const highRisk: ProjectRiskResult[] = [];

  for (const project of allProjects) {
    const projectTasks = allTasks.filter((t) => t.projectId === project.id);
    const projectTimeEntries = allTimeEntries.filter(
      (te) => te.projectId === project.id,
    );

    const completedTasks = projectTasks.filter(
      (t) => t.status === "completed",
    ).length;
    const totalTasks = projectTasks.length;
    const completionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    let delayRisk = 0;
    let budgetRisk = 0;

    if (project.endDate) {
      const endDate = new Date(project.endDate);
      const daysRemaining = Math.ceil(
        (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      const progress = project.progress || 0;
      const startMs = project.startDate
        ? new Date(project.startDate).getTime()
        : now.getTime();
      const totalDays = Math.max(
        1,
        (endDate.getTime() - startMs) / (1000 * 60 * 60 * 24),
      );
      const expectedProgress =
        daysRemaining > 0
          ? Math.max(0, 100 - (daysRemaining / totalDays) * 100)
          : 100;

      if (progress < expectedProgress - 10) {
        delayRisk = Math.min(100, (expectedProgress - progress) * 2);
      }
    }

    const overdueTasks = projectTasks.filter((t) => {
      if (!t.endDate) return false;
      return new Date(t.endDate) < now && t.status !== "completed";
    });

    if (overdueTasks.length > 0) {
      delayRisk = Math.min(100, delayRisk + overdueTasks.length * 15);
    }

    const estimatedHours = projectTasks.reduce(
      (sum, t) => sum + (Number(t.estimatedHours) || 0),
      0,
    );
    const actualHours = projectTimeEntries.reduce(
      (sum, te) => sum + (te.duration || 0) / 60,
      0,
    );

    if (estimatedHours > 0 && actualHours > estimatedHours * 1.2) {
      budgetRisk = Math.min(
        100,
        ((actualHours - estimatedHours) / estimatedHours) * 50,
      );
    }

    const overallRisk = Math.min(
      100,
      delayRisk * 0.5 + budgetRisk * 0.3,
    );

    if (overallRisk < 70) continue;

    const reasons: string[] = [];
    if (delayRisk > 50) reasons.push("High delay risk detected");
    if (budgetRisk > 50) reasons.push("Budget overrun risk");
    if (overdueTasks.length > 0) reasons.push(`${overdueTasks.length} overdue task${overdueTasks.length > 1 ? "s" : ""}`);
    if (completionRate < 50 && totalTasks > 5) reasons.push("Low completion rate");

    highRisk.push({
      projectId: project.id,
      projectName: project.name,
      projectNumber: project.projectNumber,
      organizationId: project.organizationId,
      assignedTo: project.assignedTo ?? null,
      riskScore: Math.round(overallRisk),
      delayRisk: Math.round(delayRisk),
      budgetRisk: Math.round(budgetRisk),
      reasons,
    });
  }

  return highRisk;
}
