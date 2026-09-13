import { and, eq, exists, or, sql } from "drizzle-orm";
import { database } from "@/configs/connection.config";
import {
  projects,
  tasks,
  clients,
  projectComments,
  userOrganizations,
} from "@/schema/schema";
import { Actor, canPerform, canViewProjectFinancials } from "./resource-policy";
import { createResourceGuards } from "./resource-guards";
import { findFileResource } from "./file-resource";

export function projectReadScope(actor: Actor) {
  if (!canPerform(actor, "read")) return sql`false`;
  const visibility =
    actor.role === "client"
      ? exists(
          database
            .select({ id: clients.id })
            .from(clients)
            .where(
              and(
                eq(clients.id, projects.clientId),
                eq(clients.userId, actor.id),
                eq(clients.organizationId, actor.organizationId!),
              ),
            ),
        )
      : or(
          eq(projects.createdBy, actor.id),
          eq(projects.assignedTo, actor.id),
          eq(projects.visibility, "public"),
        );
  return and(eq(projects.organizationId, actor.organizationId!), visibility)!;
}

export function taskReadScope(actor: Actor) {
  return and(
    projectReadScope(actor),
    actor.role === "client"
      ? eq(tasks.visibility, "public")
      : or(
          eq(tasks.createdBy, actor.id),
          eq(tasks.assignedTo, actor.id),
          eq(tasks.visibility, "public"),
        ),
  )!;
}

// to_jsonb keeps this check compatible with installations predating task_id.
export function commentReadScope(actor: Actor) {
  const taskId = sql<string>`to_jsonb(${projectComments})->>'task_id'`;
  return and(
    exists(
      database
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectComments.projectId),
            projectReadScope(actor),
          ),
        ),
    ),
    or(
      sql`${taskId} is null`,
      exists(
        database
          .select({ id: tasks.id })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(
            and(
              eq(tasks.id, taskId),
              eq(tasks.projectId, projectComments.projectId),
              taskReadScope(actor),
            ),
          ),
      ),
    ),
  )!;
}

export const resourceAccess = createResourceGuards({
  member: async (userId, organizationId) =>
    !!(await database.query.userOrganizations.findFirst({
      where: and(
        eq(userOrganizations.userId, userId),
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.status, "active"),
      ),
    })),
  file: findFileResource,
  project: (id, organizationId) =>
    database.query.projects.findFirst({
      where: and(
        eq(projects.id, id),
        eq(projects.organizationId, organizationId),
      ),
    }),
  task: async (id, organizationId) => {
    const [row] = await database
      .select({ task: tasks })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(and(eq(tasks.id, id), eq(projects.organizationId, organizationId)))
      .limit(1);
    return row?.task;
  },
  client: (id, organizationId) =>
    database.query.clients.findFirst({
      where: and(
        eq(clients.id, id),
        eq(clients.organizationId, organizationId),
      ),
    }),
  ownClient: async (userId, organizationId) =>
    (
      await database.query.clients.findFirst({
        where: and(
          eq(clients.userId, userId),
          eq(clients.organizationId, organizationId),
        ),
      })
    )?.id,
  comment: async (id) =>
    (
      await database
        .select({
          projectId: projectComments.projectId,
          userId: projectComments.userId,
          parentId: projectComments.parentId,
          taskId: sql<string | null>`to_jsonb(${projectComments})->>'task_id'`,
        })
        .from(projectComments)
        .where(eq(projectComments.id, id))
        .limit(1)
    )[0],
});

// Return null rather than an invented zero for restricted monetary values.
export const projectBudget = (actor: Actor, budget: string | null) =>
  canViewProjectFinancials(actor) ? budget : null;
