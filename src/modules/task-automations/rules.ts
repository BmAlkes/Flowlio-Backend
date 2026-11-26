import { z } from "zod";

/** "When <trigger>, if <conditions>, then <actions>" for tasks, like a Monday automation recipe. */
export const TASK_STATUSES = ["todo", "in_progress", "delay", "changes", "updated", "completed"] as const;
export const MAX_RULES = 50;
export const MAX_CHAIN = 3;

const id = z.string().min(1).max(128);
const status = z.enum(TASK_STATUSES);
const value = z.union([z.string().max(2000), z.number(), z.boolean()]);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task_created") }).strict(),
  z.object({ type: z.literal("status_changed"), to: status.optional() }).strict(),
  z.object({ type: z.literal("field_changed"), fieldId: id, to: value.optional() }).strict(),
  z.object({ type: z.literal("assignee_changed") }).strict(),
  // offsetDays: 0 on the due date, 2 two days before, -1 a day after.
  z.object({ type: z.literal("due_date"), offsetDays: z.number().int().min(-30).max(30) }).strict(),
  z.object({ type: z.literal("schedule"), every: z.enum(["day", "week", "month"]), weekday: z.number().int().min(0).max(6).optional(), monthDay: z.number().int().min(1).max(28).optional() }).strict()
    .refine(t => t.every !== "week" || t.weekday !== undefined, { message: "Choose the weekday" })
    .refine(t => t.every !== "month" || t.monthDay !== undefined, { message: "Choose the day of the month" }),
]);

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), op: z.enum(["is", "is_not"]), value: status }).strict(),
  z.object({ type: z.literal("field"), fieldId: id, op: z.enum(["is", "is_not", "empty", "not_empty"]), value: value.optional() }).strict(),
  z.object({ type: z.literal("assignee"), op: z.enum(["is", "empty", "not_empty"]), value: id.optional() }).strict(),
]);

/** Who gets a notification: people tied to the task, or one member. */
const recipient = z.union([z.enum(["assignee", "creator", "project_owner"]), z.object({ userId: id }).strict()]);

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("notify"), recipient, channel: z.enum(["internal", "email"]).default("internal"), message: z.string().trim().min(1).max(500) }).strict(),
  z.object({ type: z.literal("set_status"), status }).strict(),
  z.object({ type: z.literal("set_field"), fieldId: id, value: value.nullable() }).strict(),
  z.object({ type: z.literal("assign"), userId: z.union([id, z.literal("creator")]) }).strict(),
  z.object({ type: z.literal("set_due"), days: z.number().int().min(0).max(365) }).strict(),
  z.object({ type: z.literal("move_project"), projectId: id }).strict(),
  z.object({ type: z.literal("create_task"), title: z.string().trim().min(1).max(200), projectId: z.union([id, z.literal("same")]), assignee: z.union([id, z.literal("same"), z.literal("none")]).default("none"), dueInDays: z.number().int().min(0).max(365).optional() }).strict(),
]);

export const ruleInput = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  projectId: id.nullable().optional(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(5).default([]),
  actions: z.array(actionSchema).min(1).max(5),
}).strict().superRefine((rule, context) => {
  // A scheduled rule has no task to look at, so it can only create tasks.
  if (rule.trigger.type === "schedule") {
    if (rule.conditions.length) context.addIssue({ code: "custom", path: ["conditions"], message: "Scheduled rules have no conditions" });
    if (rule.actions.some(action => action.type !== "create_task" || action.projectId === "same" || action.assignee === "same")) {
      context.addIssue({ code: "custom", path: ["actions"], message: "Scheduled rules can only create tasks in a chosen project" });
    }
  }
});

export type Trigger = z.infer<typeof triggerSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type RuleInput = z.infer<typeof ruleInput>;
export type Rule = RuleInput & { id: string; organizationId: string; createdBy: string };

/** What the database trigger records about a change. */
export type TaskEvent = {
  id: number;
  organizationId: string;
  taskId: string;
  projectId: string | null;
  kind: "created" | "updated";
  changes: { status?: Change; assignee?: Change; dueDate?: Change; project?: Change; fields?: Record<string, Change> };
  depth: number;
};
type Change = { from: unknown; to: unknown };
export type TaskState = { id: string; title: string; status: string; assignedTo: string | null; createdBy: string; projectId: string; projectName: string; endDate: string | null; customFields: Record<string, unknown> };

const same = (a: unknown, b: unknown) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/** Whether a change event fires a rule. Date and schedule triggers are not event-based. */
export function triggerMatches(trigger: Trigger, event: TaskEvent) {
  switch (trigger.type) {
    case "task_created":
      return event.kind === "created";
    case "status_changed":
      return !!event.changes.status && (trigger.to === undefined || event.changes.status.to === trigger.to);
    case "field_changed": {
      const change = event.changes.fields?.[trigger.fieldId];
      return !!change && (trigger.to === undefined || same(change.to, trigger.to));
    }
    case "assignee_changed":
      return !!event.changes.assignee && event.changes.assignee.to != null;
    default:
      return false;
  }
}

const empty = (value: unknown) => value === null || value === undefined || value === "";

export function conditionsMatch(conditions: Condition[], task: TaskState) {
  return conditions.every(condition => {
    if (condition.type === "status") return condition.op === "is" ? task.status === condition.value : task.status !== condition.value;
    if (condition.type === "assignee") {
      if (condition.op === "empty") return !task.assignedTo;
      if (condition.op === "not_empty") return !!task.assignedTo;
      return task.assignedTo === condition.value;
    }
    const current = task.customFields[condition.fieldId];
    if (condition.op === "empty") return empty(current);
    if (condition.op === "not_empty") return !empty(current);
    return condition.op === "is" ? same(current, condition.value) : !same(current, condition.value);
  });
}

/** {{task}}, {{project}}, {{status}} and {{due}} in messages and titles. */
export function render(template: string, task: TaskState | null) {
  return template
    .replace(/\{\{\s*task\s*\}\}/g, task?.title ?? "")
    .replace(/\{\{\s*project\s*\}\}/g, task?.projectName ?? "")
    .replace(/\{\{\s*status\s*\}\}/g, task?.status ?? "")
    .replace(/\{\{\s*due\s*\}\}/g, task?.endDate ? task.endDate.slice(0, 10) : "")
    .slice(0, 500);
}

/** Key that makes a date or schedule run happen once per period. */
export function scheduleKey(trigger: Extract<Trigger, { type: "schedule" }>, today: Date) {
  const iso = today.toISOString().slice(0, 10);
  if (trigger.every === "day") return iso;
  if (trigger.every === "week") return today.getUTCDay() === trigger.weekday ? iso : null;
  return today.getUTCDate() === trigger.monthDay ? iso : null;
}

export const addDays = (today: Date, days: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days)).toISOString().slice(0, 10);
