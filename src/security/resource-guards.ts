import type { Request, RequestHandler } from "express";
import {
  Actor,
  ProjectResource,
  TaskResource,
  ResourceAction,
  canPerform,
  canReadProject,
  canReadTask,
  canManageClients,
  canViewProjectFinancials,
} from "./resource-policy";

export interface ResourceRepository {
  project(
    id: string,
    organizationId: string,
  ): Promise<ProjectResource | undefined>;
  task(id: string, organizationId: string): Promise<TaskResource | undefined>;
  client(
    id: string,
    organizationId: string,
  ): Promise<{ id: string; userId: string | null } | undefined>;
  ownClient(
    userId: string,
    organizationId: string,
  ): Promise<string | undefined>;
  member?(userId: string, organizationId: string): Promise<boolean>;
  comment(
    id: string,
  ): Promise<
    | {
        projectId: string;
        userId: string;
        parentId?: string | null;
        taskId?: string | null;
      }
    | undefined
  >;
  file?(
    id: string,
    organizationId: string,
  ): Promise<
    | {
        organizationId: string;
        projectId?: string | null;
        taskId?: string | null;
        clientId?: string | null;
        uploadedBy?: string | null;
      }
    | undefined
  >;
}

type Identifier = (req: Request) => unknown;
class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const identifier = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim())
    throw new AccessError(400, "Resource ID is required");
  return value;
};

export function createResourceGuards(repository: ResourceRepository) {
  const guard =
    (
      check: (req: Request, actor: Actor) => Promise<void> | void,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        if (!req.user) throw new AccessError(401, "Authentication required");
        if (!req.user.organizationId)
          throw new AccessError(403, "Organization context required");
        await check(req, req.user);
        next();
      } catch (error) {
        if (error instanceof AccessError)
          res
            .status(error.status)
            .json({ success: false, message: error.message });
        else next(error);
      }
    };
  const action = (actor: Actor, value: ResourceAction) => {
    if (!canPerform(actor, value)) throw new AccessError(403, "Access denied");
  };
  const project = async (actor: Actor, id: string) => {
    const value = await repository.project(id, actor.organizationId!);
    const clientId =
      actor.role === "client"
        ? await repository.ownClient(actor.id, actor.organizationId!)
        : undefined;
    if (!value || !canReadProject(actor, value, clientId))
      throw new AccessError(404, "Resource not found");
    return value;
  };
  const task = async (actor: Actor, id: string) => {
    const value = await repository.task(id, actor.organizationId!);
    if (!value) throw new AccessError(404, "Resource not found");
    const parent = await project(actor, value.projectId);
    const clientId =
      actor.role === "client"
        ? await repository.ownClient(actor.id, actor.organizationId!)
        : undefined;
    if (!canReadTask(actor, value, parent, clientId))
      throw new AccessError(404, "Resource not found");
    return value;
  };
  return {
    staff: guard((_req, actor) => {
      if (!canPerform(actor, "track"))
        throw new AccessError(403, "Access denied");
    }),
    action: (value: ResourceAction) =>
      guard((_req, actor) => action(actor, value)),
    project: (getId: Identifier, value: ResourceAction = "read") =>
      guard(async (req, actor) => {
        action(actor, value);
        await project(actor, identifier(getId(req)));
      }),
    task: (getId: Identifier, value: ResourceAction = "read") =>
      guard(async (req, actor) => {
        action(actor, value);
        const resource = await task(actor, identifier(getId(req)));
        if (
          value === "track" &&
          resource.assignedTo !== actor.id &&
          resource.createdBy !== actor.id
        )
          throw new AccessError(403, "Only your own tasks can be tracked");
      }),
    client: (getId: Identifier, financial = false) =>
      guard(async (req, actor) => {
        action(actor, "read");
        if (financial && actor.role !== "client" && !canManageClients(actor))
          throw new AccessError(403, "Access denied");
        const resource = await repository.client(
          identifier(getId(req)),
          actor.organizationId!,
        );
        if (
          !resource ||
          (actor.role === "client" && resource.userId !== actor.id)
        )
          throw new AccessError(404, "Resource not found");
      }),
    financial: guard((_req, actor) => {
      if (!canViewProjectFinancials(actor))
        throw new AccessError(403, "Access denied");
    }),
    file: (getId: Identifier, value: ResourceAction = "read") =>
      guard(async (req, actor) => {
        action(
          actor,
          value === "create" || value === "delete" ? "comment" : value,
        );
        const file = await repository.file?.(
          identifier(getId(req)),
          actor.organizationId!,
        );
        if (!file || file.organizationId !== actor.organizationId)
          throw new AccessError(404, "Resource not found");
        if (file.taskId) {
          const linkedTask = await task(actor, file.taskId);
          if (file.projectId && linkedTask.projectId !== file.projectId)
            throw new AccessError(404, "Resource not found");
        } else if (file.projectId) await project(actor, file.projectId);
        else if (file.clientId) {
          const client = await repository.client(
            file.clientId,
            actor.organizationId!,
          );
          if (
            !client ||
            (actor.role === "client"
              ? client.userId !== actor.id
              : !canManageClients(actor) && file.uploadedBy !== actor.id)
          )
            throw new AccessError(404, "Resource not found");
        } else if (file.uploadedBy !== actor.id)
          throw new AccessError(404, "Resource not found");
        if (
          value === "delete" &&
          file.uploadedBy !== actor.id &&
          actor.role !== "superadmin"
        )
          throw new AccessError(403, "Only your own files can be deleted");
      }),
    projectFields: guard(async (req, actor) => {
      if (
        Object.prototype.hasOwnProperty.call(req.body ?? {}, "budget") &&
        !canViewProjectFinancials(actor)
      )
        throw new AccessError(403, "Internal financial access required");
      if (
        req.body?.clientId &&
        !(await repository.client(
          identifier(req.body.clientId),
          actor.organizationId!,
        ))
      )
        throw new AccessError(404, "Resource not found");
    }),
    clientFileReferences: guard(async (req, actor) => {
      if (req.body?.projectId) {
        const parent = await project(actor, identifier(req.body.projectId));
        if (parent.clientId !== req.params.clientId)
          throw new AccessError(404, "Resource not found");
      }
    }),
    taskReferences: guard(async (req, actor) => {
      if (
        req.body?.assignedTo &&
        !(await repository.member?.(
          identifier(req.body.assignedTo),
          actor.organizationId!,
        ))
      )
        throw new AccessError(404, "Assignee not found");
      if (req.body?.projectId)
        await project(actor, identifier(req.body.projectId));
      for (const key of ["parentId", "startAfter", "finishBefore"]) {
        if (req.body?.[key]) await task(actor, identifier(req.body[key]));
      }
    }),
    reorder: guard(async (req, actor) => {
      action(actor, "update");
      if (!Array.isArray(req.body?.updates) || !req.body.updates.length)
        throw new AccessError(400, "Updates are required");
      for (const update of req.body.updates)
        await project(actor, identifier(update?.projectId));
    }),
    comment: (getId: Identifier) =>
      guard(async (req, actor) => {
        action(actor, "comment");
        const resource = await repository.comment(identifier(getId(req)));
        if (!resource) throw new AccessError(404, "Resource not found");
        await project(actor, resource.projectId);
        if (resource.taskId) await task(actor, resource.taskId);
        if (resource.userId !== actor.id)
          throw new AccessError(403, "Only your own comments can be changed");
      }),
    commentReferences: guard(async (req, actor) => {
      const projectId = identifier(req.body?.projectId);
      await project(actor, projectId);
      if (req.body?.parentId) {
        const parent = await repository.comment(identifier(req.body.parentId));
        if (!parent || parent.projectId !== projectId)
          throw new AccessError(404, "Resource not found");
        if (parent.taskId) await task(actor, parent.taskId);
      }
      if (req.body?.taskId) {
        const linkedTask = await task(actor, identifier(req.body.taskId));
        if (linkedTask.projectId !== projectId)
          throw new AccessError(404, "Resource not found");
      }
    }),
  };
}
