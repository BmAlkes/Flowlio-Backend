export interface Actor {
  id: string;
  role: string;
  organizationId?: string | null;
  isOrganizationOwner?: boolean;
  isOrganizationManager?: boolean;
}

export interface ProjectResource {
  id: string;
  organizationId: string;
  createdBy: string;
  assignedTo?: string | null;
  clientId?: string | null;
  visibility?: string | null;
}

export interface TaskResource {
  id: string;
  projectId: string;
  createdBy: string;
  assignedTo?: string | null;
  visibility?: string | null;
}

export type ResourceAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "track"
  | "comment";
const staffRoles = ["superadmin", "subadmin", "user", "operator", "viewer"];

export function canManageClients(actor: Actor): boolean {
  return (
    actor.role === "superadmin" ||
    actor.role === "subadmin" ||
    (actor.role === "user" &&
      (actor.isOrganizationOwner === true ||
        actor.isOrganizationManager === true))
  );
}

// Internal costs follow the existing frontend policy; managers do not gain cost access.
export function canViewProjectFinancials(actor: Actor): boolean {
  return (
    actor.role === "superadmin" ||
    actor.role === "subadmin" ||
    (actor.role === "user" && actor.isOrganizationOwner === true)
  );
}

export function canPerform(actor: Actor, action: ResourceAction): boolean {
  if (!actor.organizationId) return false;
  if (action === "read" || action === "comment")
    return staffRoles.includes(actor.role) || actor.role === "client";
  if (action === "track") return staffRoles.includes(actor.role);
  if (action === "update")
    return ["superadmin", "subadmin", "user", "operator"].includes(actor.role);
  return ["superadmin", "subadmin", "user"].includes(actor.role);
}

export function canReadProject(
  actor: Actor,
  project: ProjectResource,
  ownClientId?: string,
): boolean {
  if (
    !canPerform(actor, "read") ||
    actor.organizationId !== project.organizationId
  )
    return false;
  if (actor.role === "client")
    return !!ownClientId && project.clientId === ownClientId;
  return (
    project.createdBy === actor.id ||
    project.assignedTo === actor.id ||
    project.visibility === "public"
  );
}

export function canReadTask(
  actor: Actor,
  task: TaskResource,
  project: ProjectResource,
  ownClientId?: string,
): boolean {
  if (
    task.projectId !== project.id ||
    !canReadProject(actor, project, ownClientId)
  )
    return false;
  if (actor.role === "client") return task.visibility === "public";
  return (
    task.createdBy === actor.id ||
    task.assignedTo === actor.id ||
    task.visibility === "public"
  );
}
