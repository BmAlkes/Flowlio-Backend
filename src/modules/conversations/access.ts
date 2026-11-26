import type { Pool, PoolClient } from "pg";
import { canManageClients, canPerform, canReadProject, canReadTask, type Actor } from "../../security/resource-policy";

export class ConversationError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

export type Kind = "channel" | "project" | "task" | "client" | "direct";
export type Conversation = {
  id: string; organizationId: string; kind: Kind; name: string | null;
  projectId: string | null; taskId: string | null; clientId: string | null; createdBy: string | null; lastMessageAt: string | null;
};
/** What one person may do in one conversation. `clientOnly`: they only see and write CLIENT messages (portal users). */
export type Access = { read: boolean; post: boolean; postToClient: boolean; clientOnly: boolean; manage: boolean };

const NONE: Access = { read: false, post: false, postToClient: false, clientOnly: false, manage: false };
const STAFF = ["superadmin", "subadmin", "user", "operator", "viewer"];
export const isStaff = (actor: Actor) => !!actor.organizationId && STAFF.includes(actor.role);
export const isClient = (actor: Actor) => !!actor.organizationId && actor.role === "client";

export const conversationColumns = `c.id, c.organization_id as "organizationId", c.kind, c.name, c.project_id as "projectId", c.task_id as "taskId",
  c.client_id as "clientId", c.created_by as "createdBy", c.last_message_at as "lastMessageAt"`;

type Db = Pool | PoolClient;

/** The client record a portal user belongs to. */
export async function ownClientId(db: Db, actor: Actor) {
  if (!isClient(actor)) return null;
  return (await db.query<{ id: string }>("select id from clients where user_id=$1 and organization_id=$2 limit 1", [actor.id, actor.organizationId])).rows[0]?.id ?? null;
}

async function project(db: Db, projectId: string | null) {
  if (!projectId) return null;
  return (await db.query(`select id, organization_id as "organizationId", created_by as "createdBy", assigned_to as "assignedTo", visibility, client_id as "clientId", name from projects where id=$1`, [projectId])).rows[0] ?? null;
}

/** Same rules as projects and tasks elsewhere: a project conversation is readable by whoever can read the project. */
export async function accessTo(db: Db, actor: Actor, conversation: Conversation): Promise<Access> {
  if (conversation.organizationId !== actor.organizationId) return NONE;
  const canWrite = canPerform(actor, "comment");
  const writesToClient = ["superadmin", "subadmin", "user", "operator"].includes(actor.role);

  if (isClient(actor)) {
    const clientId = await ownClientId(db, actor);
    if (!clientId) return NONE;
    const portal: Access = { read: true, post: true, postToClient: true, clientOnly: true, manage: false };
    if (conversation.kind === "client") return conversation.clientId === clientId ? portal : NONE;
    if (conversation.kind !== "project" && conversation.kind !== "task") return NONE;
    const p = await project(db, conversation.projectId);
    if (!p || p.clientId !== clientId) return NONE;
    if (conversation.kind === "task") {
      const task = (await db.query(`select id, project_id as "projectId", created_by as "createdBy", assigned_to as "assignedTo", visibility from tasks where id=$1`, [conversation.taskId])).rows[0];
      if (!task || !canReadTask(actor, task, p, clientId)) return NONE;
    }
    return portal;
  }
  if (!isStaff(actor)) return NONE;

  switch (conversation.kind) {
    case "channel":
      return { read: true, post: canWrite, postToClient: false, clientOnly: false, manage: canManageClients(actor) || conversation.createdBy === actor.id };
    case "direct": {
      const member = (await db.query("select 1 from conversation_participants where conversation_id=$1 and user_id=$2", [conversation.id, actor.id])).rowCount;
      return member ? { read: true, post: canWrite, postToClient: false, clientOnly: false, manage: false } : NONE;
    }
    case "client":
      return canManageClients(actor) ? { read: true, post: canWrite, postToClient: writesToClient, clientOnly: false, manage: true } : NONE;
    case "project":
    case "task": {
      const p = await project(db, conversation.projectId);
      if (!p || !canReadProject(actor, p)) return NONE;
      if (conversation.kind === "task") {
        const task = (await db.query(`select id, project_id as "projectId", created_by as "createdBy", assigned_to as "assignedTo", visibility from tasks where id=$1`, [conversation.taskId])).rows[0];
        if (!task || !canReadTask(actor, task, p)) return NONE;
      }
      // Only conversations with a client can carry CLIENT messages.
      return { read: true, post: canWrite, postToClient: writesToClient && !!p.clientId, clientOnly: false, manage: canManageClients(actor) };
    }
    default:
      return NONE;
  }
}

/** People who should see a new message right away (realtime and unread badges). */
export async function audience(db: Db, conversation: Conversation, visibility: "internal" | "client") {
  const staff = (await db.query<{ id: string; owner: boolean; manager: boolean }>(
    `select u.id, coalesce(u.is_organization_owner,false) owner, coalesce(u.is_organization_manager,false) manager
     from user_organizations m join users u on u.id=m.user_id where m.organization_id=$1 and m.status='active'`, [conversation.organizationId])).rows;
  let ids: string[] = [];
  if (conversation.kind === "channel") ids = staff.map(s => s.id);
  else if (conversation.kind === "direct") ids = (await db.query<{ user_id: string }>("select user_id from conversation_participants where conversation_id=$1", [conversation.id])).rows.map(r => r.user_id);
  else if (conversation.kind === "client") ids = staff.filter(s => s.owner || s.manager).map(s => s.id);
  else {
    const p = await project(db, conversation.projectId);
    if (p) ids = p.visibility === "public" ? staff.map(s => s.id) : [p.createdBy, p.assignedTo].filter(Boolean);
  }
  if (visibility === "client") {
    const clientId = conversation.clientId ?? (await project(db, conversation.projectId))?.clientId;
    const portalUser = clientId ? (await db.query<{ user_id: string | null }>("select user_id from clients where id=$1", [clientId])).rows[0]?.user_id : null;
    if (portalUser) ids.push(portalUser);
  }
  return [...new Set(ids)];
}
