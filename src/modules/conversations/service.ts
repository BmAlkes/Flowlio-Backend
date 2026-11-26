import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, type Actor } from "../../security/resource-policy";
import { accessTo, audience, ConversationError, conversationColumns, isClient, isStaff, ownClientId, type Access, type Conversation } from "./access";
import { notifyAfterMessage } from "./notify";

export { ConversationError } from "./access";
/** Sends a realtime event to users (by id); the controller wires it to socket.io. */
export type Emit = (userIds: string[], event: string, payload: unknown) => void;

export const REACTIONS = ["👍", "❤️", "🎉", "😄", "👀", "✅"];
const id = z.string().min(1).max(128);
const postInput = z.object({
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(["internal", "client"]).default("internal"),
  parentId: id.nullable().optional(),
  mentions: z.array(id).max(20).default([]),
  taskRefs: z.array(id).max(10).default([]),
  requestApproval: z.boolean().default(false),
}).strict();
const contextInput = z.union([z.object({ projectId: id }).strict(), z.object({ taskId: id }).strict(), z.object({ clientId: id }).strict()]);
const channelInput = z.object({ name: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use letters, numbers and dashes") }).strict();
const decisionInput = z.object({ decision: z.enum(["approved", "changes"]), note: z.string().trim().max(1000).optional() }).strict();

const messageColumns = `m.id, m.conversation_id as "conversationId", m.author_id as "authorId", m.author_kind as "authorKind", m.visibility,
  case when m.deleted_at is null then m.body else '' end as body, m.parent_id as "parentId", m.mentions, m.task_refs as "taskRefs", m.approval,
  m.edited_at as "editedAt", m.deleted_at as "deletedAt", m.created_at as "createdAt", u.name as "authorName", u.image as "authorImage"`;

export function createConversations(pool: Pool) {
  async function load(db: Pool | PoolClient, actor: Actor, conversationId: string) {
    const conversation = (await db.query<Conversation>(`select ${conversationColumns} from conversations c where c.id=$1 and c.organization_id=$2 and c.archived_at is null`, [conversationId, actor.organizationId])).rows[0];
    if (!conversation) throw new ConversationError(404, "NOT_FOUND");
    const access = await accessTo(db, actor, conversation);
    if (!access.read) throw new ConversationError(404, "NOT_FOUND");
    return { conversation, access };
  }

  /** Unread top-level messages per conversation, and whether any came from the client. */
  async function unread(actor: Actor, ids: string[], clientOnly: boolean) {
    if (!ids.length) return new Map<string, { unread: number; fromClient: boolean }>();
    const rows = (await pool.query<{ id: string; unread: number; from_client: boolean }>(
      `select m.conversation_id id, count(*)::int unread, bool_or(m.author_kind='client') from_client
       from messages m left join conversation_reads r on r.conversation_id=m.conversation_id and r.user_id=$2
       where m.conversation_id=any($1::text[]) and m.parent_id is null and m.deleted_at is null and m.author_id is distinct from $2
         and m.created_at > coalesce(r.last_read_at, 'epoch') and ($3::boolean = false or m.visibility='client')
       group by 1`, [ids, actor.id, clientOnly])).rows;
    return new Map(rows.map(row => [row.id, { unread: row.unread, fromClient: row.from_client }]));
  }

  /** The sidebar: channels, project and client conversations, direct messages. Project/client rows exist even before the first message. */
  async function list(actor: Actor) {
    if (isClient(actor)) {
      const clientId = await ownClientId(pool, actor);
      if (!clientId) return { channels: [], projects: [], clients: [], directs: [], tasks: [] };
      const projects = (await pool.query(
        `select p.id as "projectId", p.name, c.id as "conversationId", c.last_message_at as "lastMessageAt" from projects p
         left join conversations c on c.kind='project' and c.project_id=p.id where p.organization_id=$1 and p.client_id=$2 order by c.last_message_at desc nulls last, p.name limit 100`,
        [actor.organizationId, clientId])).rows;
      const own = (await pool.query(`select c.id as "conversationId", c.last_message_at as "lastMessageAt" from conversations c where c.kind='client' and c.client_id=$1`, [clientId])).rows[0];
      const tasks = (await pool.query(
        `select c.id as "conversationId", t.title as name, t.id as "taskId", c.last_message_at as "lastMessageAt" from conversations c join tasks t on t.id=c.task_id join projects p on p.id=t.project_id
         where c.kind='task' and p.client_id=$1 and t.visibility='public' and exists (select 1 from messages m where m.conversation_id=c.id and m.visibility='client') order by c.last_message_at desc nulls last limit 50`, [clientId])).rows;
      const counts = await unread(actor, [...projects, ...tasks, ...(own ? [own] : [])].map(row => row.conversationId).filter(Boolean), true);
      const withUnread = <T extends { conversationId?: string | null }>(row: T) => ({ ...row, ...(counts.get(row.conversationId ?? "") ?? { unread: 0, fromClient: false }) });
      return { channels: [], directs: [], projects: projects.map(withUnread), tasks: tasks.map(withUnread), clients: [withUnread({ clientId, name: null, conversationId: own?.conversationId ?? null, lastMessageAt: own?.lastMessageAt ?? null })] };
    }
    if (!isStaff(actor)) throw new ConversationError(403, "FORBIDDEN");
    // Every organization starts with a #geral channel.
    await pool.query(`insert into conversations (id, organization_id, kind, name, created_by) values ($1,$2,'channel','geral',null) on conflict do nothing`, [randomUUID(), actor.organizationId]);
    const channels = (await pool.query(`select c.id as "conversationId", c.name, c.last_message_at as "lastMessageAt", c.created_by as "createdBy" from conversations c where c.organization_id=$1 and c.kind='channel' and c.archived_at is null order by c.name`, [actor.organizationId])).rows;
    const directs = (await pool.query(
      `select c.id as "conversationId", c.last_message_at as "lastMessageAt", o.user_id as "userId", u.name, u.image
       from conversations c join conversation_participants me on me.conversation_id=c.id and me.user_id=$2
       join conversation_participants o on o.conversation_id=c.id and o.user_id<>$2 join users u on u.id=o.user_id
       where c.organization_id=$1 and c.kind='direct' order by c.last_message_at desc nulls last`, [actor.organizationId, actor.id])).rows;
    const projects = (await pool.query(
      `select p.id as "projectId", p.name, p.client_id as "clientId", c.id as "conversationId", c.last_message_at as "lastMessageAt" from projects p
       left join conversations c on c.kind='project' and c.project_id=p.id
       where p.organization_id=$1 and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public') and coalesce(p.status,'') not in ('cancelled','archived')
       order by c.last_message_at desc nulls last, p.created_at desc limit 100`, [actor.organizationId, actor.id])).rows;
    const clients = canManageClients(actor) ? (await pool.query(
      `select cl.id as "clientId", cl.name, c.id as "conversationId", c.last_message_at as "lastMessageAt" from clients cl
       left join conversations c on c.kind='client' and c.client_id=cl.id
       where cl.organization_id=$1 and coalesce(cl.type,'client')='client' order by c.last_message_at desc nulls last, cl.name limit 100`, [actor.organizationId])).rows : [];
    const tasks = (await pool.query(
      `select c.id as "conversationId", t.title as name, t.id as "taskId", p.name as "projectName", c.last_message_at as "lastMessageAt" from conversations c
       join tasks t on t.id=c.task_id join projects p on p.id=t.project_id
       where c.organization_id=$1 and c.kind='task' and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')
         and (t.created_by=$2 or t.assigned_to=$2 or t.visibility='public') and c.last_message_at > now() - interval '30 days'
       order by c.last_message_at desc limit 30`, [actor.organizationId, actor.id])).rows;
    const counts = await unread(actor, [...channels, ...directs, ...projects, ...clients, ...tasks].map(row => row.conversationId).filter(Boolean), false);
    const withUnread = <T extends { conversationId?: string | null }>(row: T) => ({ ...row, ...(counts.get(row.conversationId ?? "") ?? { unread: 0, fromClient: false }) });
    return { channels: channels.map(withUnread), directs: directs.map(withUnread), projects: projects.map(withUnread), clients: clients.map(withUnread), tasks: tasks.map(withUnread) };
  }

  /** Finds or creates the conversation of a project, task or client, after checking access. */
  async function forContext(actor: Actor, raw: unknown) {
    const parsed = contextInput.safeParse(raw);
    if (!parsed.success) throw new ConversationError(400, "INVALID_REQUEST");
    const input = parsed.data as { projectId?: string; taskId?: string; clientId?: string };
    let draft: Conversation;
    if (input.taskId) {
      const task = (await pool.query(`select t.id, t.project_id, p.organization_id from tasks t join projects p on p.id=t.project_id where t.id=$1`, [input.taskId])).rows[0];
      if (!task || task.organization_id !== actor.organizationId) throw new ConversationError(404, "NOT_FOUND");
      draft = { id: "", organizationId: task.organization_id, kind: "task", name: null, projectId: task.project_id, taskId: task.id, clientId: null, createdBy: actor.id, lastMessageAt: null };
    } else if (input.projectId) {
      draft = { id: "", organizationId: actor.organizationId!, kind: "project", name: null, projectId: input.projectId, taskId: null, clientId: null, createdBy: actor.id, lastMessageAt: null };
    } else {
      const client = (await pool.query("select id from clients where id=$1 and organization_id=$2", [input.clientId, actor.organizationId])).rows[0];
      if (!client) throw new ConversationError(404, "NOT_FOUND");
      draft = { id: "", organizationId: actor.organizationId!, kind: "client", name: null, projectId: null, taskId: null, clientId: input.clientId!, createdBy: actor.id, lastMessageAt: null };
    }
    const access = await accessTo(pool, actor, draft);
    if (!access.read) throw new ConversationError(404, "NOT_FOUND");
    const column = draft.kind === "task" ? "task_id" : draft.kind === "project" ? "project_id" : "client_id";
    const value = draft.taskId ?? draft.projectId ?? draft.clientId;
    await pool.query(
      `insert into conversations (id, organization_id, kind, project_id, task_id, client_id, created_by) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
      [randomUUID(), draft.organizationId, draft.kind, draft.projectId, draft.taskId, draft.clientId, isStaff(actor) ? actor.id : null]);
    const conversation = (await pool.query<Conversation>(`select ${conversationColumns} from conversations c where c.kind=$1 and c.${column}=$2`, [draft.kind, value])).rows[0];
    return describe(conversation, access);
  }

  async function describe(conversation: Conversation, access: Access) {
    const title = conversation.kind === "channel" ? conversation.name
      : conversation.kind === "client" ? (await pool.query("select name from clients where id=$1", [conversation.clientId])).rows[0]?.name
      : conversation.kind === "task" ? (await pool.query("select title from tasks where id=$1", [conversation.taskId])).rows[0]?.title
      : conversation.kind === "project" ? (await pool.query("select name from projects where id=$1", [conversation.projectId])).rows[0]?.name
      : null;
    const clientName = conversation.kind === "project" || conversation.kind === "task"
      ? (await pool.query("select cl.name from projects p join clients cl on cl.id=p.client_id where p.id=$1", [conversation.projectId])).rows[0]?.name ?? null
      : null;
    return { ...conversation, title, clientName, access };
  }

  async function open(actor: Actor, conversationId: string) {
    const { conversation, access } = await load(pool, actor, conversationId);
    const described = await describe(conversation, access);
    if (conversation.kind === "direct") {
      const other = (await pool.query("select u.id, u.name, u.image from conversation_participants p join users u on u.id=p.user_id where p.conversation_id=$1 and p.user_id<>$2", [conversation.id, actor.id])).rows[0];
      return { ...described, title: other?.name ?? described.title, other };
    }
    return described;
  }

  async function createChannel(actor: Actor, raw: unknown) {
    if (!isStaff(actor) || !["superadmin", "subadmin", "user"].includes(actor.role)) throw new ConversationError(403, "FORBIDDEN");
    const parsed = channelInput.safeParse(raw);
    if (!parsed.success) throw new ConversationError(400, "INVALID_CHANNEL", parsed.error.issues[0]?.message);
    const created = (await pool.query(`insert into conversations (id, organization_id, kind, name, created_by) values ($1,$2,'channel',$3,$4) on conflict do nothing returning id`, [randomUUID(), actor.organizationId, parsed.data.name, actor.id])).rows[0];
    if (!created) throw new ConversationError(409, "CHANNEL_EXISTS", "A channel with this name already exists");
    return open(actor, created.id);
  }

  async function direct(actor: Actor, raw: unknown) {
    if (!isStaff(actor)) throw new ConversationError(403, "FORBIDDEN");
    const parsed = z.object({ userId: id }).strict().safeParse(raw);
    if (!parsed.success || parsed.data.userId === actor.id) throw new ConversationError(400, "INVALID_REQUEST");
    const other = (await pool.query("select 1 from user_organizations where organization_id=$1 and user_id=$2 and status='active'", [actor.organizationId, parsed.data.userId])).rowCount;
    if (!other) throw new ConversationError(404, "NOT_FOUND");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const pair = [actor.id, parsed.data.userId].sort().join(":");
      await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", ["direct:" + actor.organizationId + ":" + pair]);
      let conversationId = (await client.query<{ id: string }>(
        `select c.id from conversations c join conversation_participants a on a.conversation_id=c.id and a.user_id=$2 join conversation_participants b on b.conversation_id=c.id and b.user_id=$3
         where c.organization_id=$1 and c.kind='direct' limit 1`, [actor.organizationId, actor.id, parsed.data.userId])).rows[0]?.id;
      if (!conversationId) {
        conversationId = randomUUID();
        await client.query(`insert into conversations (id, organization_id, kind, created_by) values ($1,$2,'direct',$3)`, [conversationId, actor.organizationId, actor.id]);
        await client.query("insert into conversation_participants (conversation_id, user_id) values ($1,$2),($1,$3)", [conversationId, actor.id, parsed.data.userId]);
      }
      await client.query("commit");
      return open(actor, conversationId);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  /** Adds reply counts, reactions and the cards of referenced tasks to a page of messages. */
  async function decorate(actor: Actor, rows: Record<string, any>[], clientOnly: boolean) {
    if (!rows.length) return rows;
    const ids = rows.map(row => row.id);
    const replies = new Map((await pool.query<{ parent_id: string; n: number; last: string }>(
      `select parent_id, count(*)::int n, max(created_at) last from messages where parent_id=any($1::text[]) and deleted_at is null and ($2::boolean=false or visibility='client') group by 1`, [ids, clientOnly])).rows.map(r => [r.parent_id, { count: r.n, lastAt: r.last }]));
    const reactions = (await pool.query<{ message_id: string; emoji: string; n: number; mine: boolean }>(
      `select message_id, emoji, count(*)::int n, bool_or(user_id=$2) mine from message_reactions where message_id=any($1::text[]) group by 1,2 order by 1, min(created_at)`, [ids, actor.id])).rows;
    const taskIds = [...new Set(rows.flatMap(row => (row.taskRefs as string[]) ?? []))];
    const tasks = new Map(taskIds.length ? (await pool.query(
      `select t.id, t.title, t.status, t.end_date as "endDate", u.name as "assigneeName" from tasks t join projects p on p.id=t.project_id left join users u on u.id=t.assigned_to
       where t.id=any($1::text[]) and p.organization_id=$2`, [taskIds, actor.organizationId])).rows.map(task => [task.id, task]) : []);
    return rows.map(row => ({
      ...row,
      replies: replies.get(row.id) ?? { count: 0, lastAt: null },
      reactions: reactions.filter(r => r.message_id === row.id).map(r => ({ emoji: r.emoji, count: r.n, mine: r.mine })),
      tasks: ((row.taskRefs as string[]) ?? []).map(taskId => tasks.get(taskId)).filter(Boolean),
    }));
  }

  async function page(actor: Actor, conversationId: string, query: { before?: unknown; audience?: unknown }) {
    const { access } = await load(pool, actor, conversationId);
    const before = typeof query.before === "string" && !Number.isNaN(Date.parse(query.before)) ? query.before : null;
    const filter = access.clientOnly || query.audience === "client" ? "client" : query.audience === "internal" ? "internal" : null;
    const rows = (await pool.query(
      `select ${messageColumns} from messages m left join users u on u.id=m.author_id
       where m.conversation_id=$1 and m.parent_id is null and ($2::text is null or m.visibility=$2) and ($3::timestamptz is null or m.created_at < $3)
       order by m.created_at desc limit 50`, [conversationId, filter, before])).rows.reverse();
    return { messages: await decorate(actor, rows, access.clientOnly), hasMore: rows.length === 50 };
  }

  async function thread(actor: Actor, messageId: string) {
    const parent = (await pool.query(`select ${messageColumns} from messages m left join users u on u.id=m.author_id where m.id=$1 and m.organization_id=$2`, [messageId, actor.organizationId])).rows[0];
    if (!parent) throw new ConversationError(404, "NOT_FOUND");
    const { access } = await load(pool, actor, parent.conversationId);
    if (access.clientOnly && parent.visibility !== "client") throw new ConversationError(404, "NOT_FOUND");
    const replies = (await pool.query(
      `select ${messageColumns} from messages m left join users u on u.id=m.author_id where m.parent_id=$1 and ($2::boolean=false or m.visibility='client') order by m.created_at`, [messageId, access.clientOnly])).rows;
    const [decoratedParent, ...decoratedReplies] = await decorate(actor, [parent, ...replies], access.clientOnly);
    return { parent: decoratedParent, replies: decoratedReplies };
  }

  async function post(actor: Actor, conversationId: string, raw: unknown, emit?: Emit) {
    const parsed = postInput.safeParse(raw);
    if (!parsed.success) throw new ConversationError(400, "INVALID_MESSAGE", parsed.error.issues[0]?.message);
    const input = parsed.data;
    const { conversation, access } = await load(pool, actor, conversationId);
    if (!access.post) throw new ConversationError(403, "FORBIDDEN");
    let visibility = access.clientOnly ? "client" : input.visibility;
    if (visibility === "client" && !access.postToClient) throw new ConversationError(403, "CLIENT_NOT_ALLOWED", "This conversation has no client");
    if (input.parentId) {
      const parent = (await pool.query("select visibility from messages where id=$1 and conversation_id=$2 and parent_id is null and deleted_at is null", [input.parentId, conversationId])).rows[0];
      if (!parent || (access.clientOnly && parent.visibility !== "client")) throw new ConversationError(404, "PARENT_NOT_FOUND");
      // A reply is seen by the same people as the message it answers.
      visibility = parent.visibility;
    }
    const mentions = access.clientOnly || !input.mentions.length ? [] : (await pool.query<{ user_id: string }>(
      "select user_id from user_organizations where organization_id=$1 and status='active' and user_id=any($2::text[])", [actor.organizationId, input.mentions])).rows.map(r => r.user_id);
    const taskRefs = access.clientOnly || !input.taskRefs.length ? [] : (await pool.query<{ id: string }>(
      "select t.id from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 and t.id=any($2::text[])", [actor.organizationId, input.taskRefs])).rows.map(r => r.id);
    const approval = input.requestApproval && visibility === "client" && !access.clientOnly ? { status: "pending", requestedBy: actor.id, requestedAt: new Date().toISOString() } : null;
    const messageId = randomUUID();
    await pool.query(
      `insert into messages (id, conversation_id, organization_id, author_id, author_kind, visibility, body, parent_id, mentions, task_refs, approval)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [messageId, conversationId, actor.organizationId, actor.id, access.clientOnly ? "client" : "member", visibility, input.body, input.parentId ?? null,
        JSON.stringify(mentions), JSON.stringify(taskRefs), approval ? JSON.stringify(approval) : null]);
    await pool.query("update conversations set last_message_at=now() where id=$1", [conversationId]);
    await markRead(actor, conversationId);
    const [message] = await decorate(actor, (await pool.query(`select ${messageColumns} from messages m left join users u on u.id=m.author_id where m.id=$1`, [messageId])).rows, access.clientOnly);
    const people = await audience(pool, conversation, visibility as "internal" | "client");
    emit?.(people.filter(userId => userId !== actor.id), "conversation:message", { conversationId, message });
    notifyAfterMessage(pool, { conversation, actor, messageId, body: input.body, visibility: visibility as "internal" | "client", mentions, fromClient: access.clientOnly, audience: people }).catch(() => undefined);
    return message;
  }

  async function ownMessage(actor: Actor, messageId: string) {
    const message = (await pool.query("select id, conversation_id, author_id, deleted_at from messages where id=$1 and organization_id=$2", [messageId, actor.organizationId])).rows[0];
    if (!message) throw new ConversationError(404, "NOT_FOUND");
    const { access, conversation } = await load(pool, actor, message.conversation_id);
    return { message, access, conversation };
  }

  async function edit(actor: Actor, messageId: string, raw: unknown, emit?: Emit) {
    const body = z.object({ body: z.string().trim().min(1).max(4000) }).strict().safeParse(raw);
    if (!body.success) throw new ConversationError(400, "INVALID_MESSAGE");
    const { message, conversation } = await ownMessage(actor, messageId);
    if (message.author_id !== actor.id || message.deleted_at) throw new ConversationError(403, "FORBIDDEN");
    await pool.query("update messages set body=$2, edited_at=now() where id=$1", [messageId, body.data.body]);
    emit?.(await audience(pool, conversation, "internal"), "conversation:changed", { conversationId: conversation.id });
    return { id: messageId, body: body.data.body };
  }

  async function remove(actor: Actor, messageId: string, emit?: Emit) {
    const { message, access, conversation } = await ownMessage(actor, messageId);
    if (message.author_id !== actor.id && !access.manage) throw new ConversationError(403, "FORBIDDEN");
    await pool.query("update messages set deleted_at=now() where id=$1", [messageId]);
    emit?.(await audience(pool, conversation, "client"), "conversation:changed", { conversationId: conversation.id });
    return { id: messageId };
  }

  async function react(actor: Actor, messageId: string, raw: unknown, emit?: Emit) {
    const parsed = z.object({ emoji: z.enum(REACTIONS as [string, ...string[]]) }).strict().safeParse(raw);
    if (!parsed.success) throw new ConversationError(400, "INVALID_REACTION");
    const { access, conversation } = await ownMessage(actor, messageId);
    if (!access.post) throw new ConversationError(403, "FORBIDDEN");
    const removed = await pool.query("delete from message_reactions where message_id=$1 and user_id=$2 and emoji=$3", [messageId, actor.id, parsed.data.emoji]);
    if (!removed.rowCount) await pool.query("insert into message_reactions (message_id, user_id, emoji) values ($1,$2,$3) on conflict do nothing", [messageId, actor.id, parsed.data.emoji]);
    emit?.(await audience(pool, conversation, "client"), "conversation:changed", { conversationId: conversation.id });
    return { messageId, emoji: parsed.data.emoji, active: !removed.rowCount };
  }

  /** The client approves or asks for changes on a message that requested approval. */
  async function decide(actor: Actor, messageId: string, raw: unknown, emit?: Emit) {
    const parsed = decisionInput.safeParse(raw);
    if (!parsed.success) throw new ConversationError(400, "INVALID_REQUEST");
    const { conversation, access } = await ownMessage(actor, messageId);
    if (!access.clientOnly) throw new ConversationError(403, "FORBIDDEN", "Only the client decides");
    const client = await pool.connect();
    try {
      await client.query("begin");
      const row = (await client.query("select approval, visibility from messages where id=$1 for update", [messageId])).rows[0];
      if (!row?.approval || row.visibility !== "client" || row.approval.status !== "pending") throw new ConversationError(409, "NOT_PENDING", "Already decided");
      const approval = { ...row.approval, status: parsed.data.decision, decidedBy: actor.id, decidedAt: new Date().toISOString(), note: parsed.data.note ?? null };
      await client.query("update messages set approval=$2 where id=$1", [messageId, JSON.stringify(approval)]);
      const name = (await client.query("select name from users where id=$1", [actor.id])).rows[0]?.name ?? "";
      const text = parsed.data.decision === "approved" ? `${name} aprovou.` : `${name} pediu ajustes${parsed.data.note ? `: ${parsed.data.note}` : "."}`;
      await client.query(
        `insert into messages (id, conversation_id, organization_id, author_id, author_kind, visibility, body, parent_id) values ($1,$2,$3,$4,'system','client',$5,$6)`,
        [randomUUID(), conversation.id, actor.organizationId, actor.id, text, messageId]);
      await client.query("update conversations set last_message_at=now() where id=$1", [conversation.id]);
      await client.query(
        `insert into notifications (id, user_id, organization_id, type, title, message, data, read, created_at) values ($1,$2,$3,'system',$4,$5,$6,false,now())`,
        [randomUUID(), row.approval.requestedBy, actor.organizationId, parsed.data.decision === "approved" ? "Aprovado pelo cliente" : "Cliente pediu ajustes", text.slice(0, 500), JSON.stringify({ conversationId: conversation.id, messageId })]);
      await client.query("commit");
      emit?.(await audience(pool, conversation, "client"), "conversation:changed", { conversationId: conversation.id });
      return { id: messageId, approval };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function markRead(actor: Actor, conversationId: string) {
    await pool.query(
      `insert into conversation_reads (conversation_id, user_id, last_read_at) values ($1,$2,now()) on conflict (conversation_id, user_id) do update set last_read_at=now()`,
      [conversationId, actor.id]);
    return { conversationId };
  }

  async function read(actor: Actor, conversationId: string) {
    await load(pool, actor, conversationId);
    return markRead(actor, conversationId);
  }

  return { list, forContext, open, createChannel, direct, page, thread, post, edit, remove, react, decide, read };
}
