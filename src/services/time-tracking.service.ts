import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { database } from "@/configs/connection.config";
import { projects, tasks, timeEntries, recentActivities } from "@/schema/schema";
import { Actor, canPerform } from "@/security/resource-policy";
import { taskReadScope } from "@/security/resource-access";

export class TimeTrackingError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function trackTime(actor: Actor | undefined, taskId: string, operation: "start" | "stop", entryId?: string) {
  if (!actor?.id) throw new TimeTrackingError(401, "Authentication required");
  if (!actor.organizationId || !canPerform(actor, "track")) throw new TimeTrackingError(403, "Time tracking is not allowed");
  if (operation === "stop" && !entryId) throw new TimeTrackingError(400, "Refresh the application before stopping this timer");

  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"time-tracking:" + actor.id}, 0))`);
    const [task] = await tx.select({ id: tasks.id, title: tasks.title, projectId: tasks.projectId })
      .from(tasks).innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.id, taskId), taskReadScope(actor))).limit(1);
    if (!task) throw new TimeTrackingError(404, "Task not found or not accessible");

    const id = entryId ?? randomUUID();
    const [existing] = await tx.select().from(timeEntries).where(eq(timeEntries.id, id)).for("update");
    if (existing && (existing.userId !== actor.id || existing.taskId !== taskId || existing.projectId !== task.projectId)) {
      throw new TimeTrackingError(404, "Time entry not found");
    }
    const result = (entry: typeof timeEntries.$inferSelect, replayed: boolean) => ({
      timeEntryId: entry.id, taskId, taskTitle: task.title, startTime: entry.startTime,
      endTime: entry.endTime, duration: entry.duration, status: entry.status, replayed,
    });

    if (operation === "start") {
      if (existing) return result(existing, true);
      const [active] = await tx.select({ id: timeEntries.id }).from(timeEntries)
        .where(and(eq(timeEntries.userId, actor.id), eq(timeEntries.status, "active"))).limit(1);
      if (active) throw new TimeTrackingError(409, "Stop your active timer before starting another task");
      const [entry] = await tx.insert(timeEntries).values({
        id, userId: actor.id, projectId: task.projectId, taskId, startTime: new Date(),
        status: "active", description: "Working on: " + task.title,
      }).returning();
      await tx.insert(recentActivities).values({
        organizationId: actor.organizationId, actorId: actor.id, userId: actor.id,
        type: "task", action: "start", resource: "task", resourceId: taskId,
        message: "Started tracking task: " + task.title, metadata: { timeEntryId: entry.id },
      });
      return result(entry, false);
    }

    if (!existing) throw new TimeTrackingError(404, "Time entry not found");
    if (existing.status === "completed") return result(existing, true);
    if (existing.status !== "active") throw new TimeTrackingError(409, "This time entry is not running");
    const endTime = new Date(Math.max(Date.now(), existing.startTime.getTime()));
    const duration = Math.floor((endTime.getTime() - existing.startTime.getTime()) / 60000);
    const [entry] = await tx.update(timeEntries).set({ endTime, duration, status: "completed", updatedAt: new Date() })
      .where(and(eq(timeEntries.id, id), eq(timeEntries.status, "active"))).returning();
    await tx.insert(recentActivities).values({
      organizationId: actor.organizationId, actorId: actor.id, userId: actor.id,
      type: "task", action: "end", resource: "task", resourceId: taskId,
      message: "Ended tracking task: " + task.title, metadata: { timeEntryId: entry.id, duration },
    });
    return result(entry, false);
  });
}
