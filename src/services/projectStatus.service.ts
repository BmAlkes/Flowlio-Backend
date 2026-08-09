export type ProjectStatus = "pending" | "ongoing" | "delayed" | "completed";

// The only statuses this automation is allowed to set/overwrite. A project
// sitting on anything else (e.g. a legacy "active", or a future "on-hold")
// was set there on purpose and must be left alone.
export const AUTO_MANAGED_PROJECT_STATUSES: readonly ProjectStatus[] = [
  "pending",
  "ongoing",
  "delayed",
  "completed",
];

export function isAutoManagedProjectStatus(
  status: string | null | undefined,
): status is ProjectStatus {
  return (
    !!status &&
    (AUTO_MANAGED_PROJECT_STATUSES as readonly string[]).includes(status)
  );
}

export interface TaskStatusInput {
  status: string | null;
  endDate: Date | string | null;
}

/**
 * Derives a project's status from its tasks. Pure function — no I/O — so it
 * can be unit tested and reused from both the task controllers and the
 * overdue-task cron.
 *
 * Precedence:
 *  1. No tasks at all -> "pending" (never force "completed" on an empty project)
 *  2. Any non-completed task whose endDate is in the past -> "delayed"
 *  3. All tasks completed (and there's at least one) -> "completed"
 *  4. At least one task in_progress/completed (but not all) -> "ongoing"
 *  5. Otherwise (everything still todo/pending) -> "pending"
 */
export function computeProjectStatus(
  taskList: TaskStatusInput[],
  now: Date = new Date(),
): ProjectStatus {
  if (taskList.length === 0) return "pending";

  const isOverdue = (task: TaskStatusInput) =>
    task.status !== "completed" &&
    !!task.endDate &&
    new Date(task.endDate) < now;

  if (taskList.some(isOverdue)) return "delayed";

  if (taskList.every((task) => task.status === "completed")) return "completed";

  if (
    taskList.some(
      (task) => task.status === "in_progress" || task.status === "completed",
    )
  ) {
    return "ongoing";
  }

  return "pending";
}
