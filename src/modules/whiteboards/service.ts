import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { canManageClients, canPerform, canReadProject, type Actor } from "../../security/resource-policy";

export class WhiteboardError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** Limits keep a board well under the 10 MB request body and the database row reasonable. */
export const LIMITS = { elements: 20000, fileBytes: 25 * 1024 * 1024, fileCount: 200, title: 200 };

type Element = { id: string; version: number; versionNonce: number; index?: string | null; type: string; fileId?: string | null; [key: string]: unknown };
type FileEntry = { id: string; mimeType: string; dataURL: string; created: number; [key: string]: unknown };

const element = z.object({ id: z.string().min(1).max(100), type: z.string().min(1).max(40), version: z.number().int().min(0), versionNonce: z.number().int() }).passthrough();
const file = z.object({
  id: z.string().min(1).max(100),
  mimeType: z.string().regex(/^image\/(png|jpeg|gif|webp|svg\+xml|bmp|x-icon|avif|jfif)$/),
  dataURL: z.string().regex(/^data:image\/[a-z+.-]+;base64,/).max(LIMITS.fileBytes),
  created: z.number(),
}).passthrough();
const appState = z.object({ viewBackgroundColor: z.string().max(40).optional(), gridSize: z.number().int().min(0).max(200).nullable().optional() }).strip();

const createInput = z.object({ title: z.string().trim().min(1).max(LIMITS.title), projectId: z.string().min(1).max(128).nullable().optional() }).strict();
const saveInput = z.object({
  title: z.string().trim().min(1).max(LIMITS.title).optional(),
  elements: z.array(element).max(LIMITS.elements).optional(),
  appState: appState.optional(),
  // Only images added since the last save are sent; the server keeps the rest.
  files: z.record(z.string(), file).optional(),
}).strict();
const projectInput = z.object({ projectId: z.string().min(1).max(128).nullable() }).strict();

/**
 * Same rule as Excalidraw's collaboration: the higher element version wins, and on a tie the lower versionNonce.
 * Deleted elements stay as tombstones (isDeleted) so a later save from someone else cannot bring them back.
 */
export function mergeElements(stored: Element[], incoming: Element[]): Element[] {
  const byId = new Map(stored.map(item => [item.id, item]));
  for (const item of incoming) {
    const current = byId.get(item.id);
    if (current && (current.version > item.version || (current.version === item.version && current.versionNonce <= item.versionNonce))) continue;
    byId.set(item.id, item);
  }
  // Fractional indices order the scene; elements without one keep their arrival order at the end.
  return [...byId.values()].map((item, position) => ({ item, position }))
    .sort((a, b) => {
      const x = a.item.index ?? null, y = b.item.index ?? null;
      if (x === y) return a.position - b.position;
      if (x === null) return 1;
      if (y === null) return -1;
      return x < y ? -1 : 1;
    })
    .map(entry => entry.item);
}

/** Keeps only images still used by a live image element, and enforces the size budget. */
export function mergeFiles(stored: Record<string, FileEntry>, incoming: Record<string, FileEntry>, elements: Element[]) {
  const used = new Set(elements.filter(item => item.type === "image" && !item.isDeleted && item.fileId).map(item => String(item.fileId)));
  const result: Record<string, FileEntry> = {};
  let bytes = 0;
  for (const [id, entry] of Object.entries({ ...stored, ...incoming })) {
    if (!used.has(id) || entry.id !== id) continue;
    result[id] = entry;
    bytes += entry.dataURL.length;
  }
  if (bytes > LIMITS.fileBytes || Object.keys(result).length > LIMITS.fileCount) throw new WhiteboardError(413, "FILES_TOO_LARGE");
  return result;
}

const STAFF = ["superadmin", "subadmin", "user", "operator", "viewer"];
const canEdit = (actor: Actor) => canPerform(actor, "update") && actor.role !== "client";

export function createWhiteboards(pool: Pool) {
  function member(actor: Actor) {
    if (!actor.organizationId || !STAFF.includes(actor.role)) throw new WhiteboardError(403, "FORBIDDEN");
    return actor.organizationId;
  }

  async function project(client: Pool | PoolClient, actor: Actor, projectId: string) {
    const row = (await client.query(
      `select id, organization_id as "organizationId", created_by as "createdBy", assigned_to as "assignedTo", visibility, name
       from projects where id = $1 and organization_id = $2`, [projectId, actor.organizationId])).rows[0];
    if (!row || !canReadProject(actor, row)) throw new WhiteboardError(404, "PROJECT_NOT_FOUND");
    return row as { id: string; name: string };
  }

  /** A board is visible to the organization's staff; a project board only to those who can see the project. */
  async function load(client: Pool | PoolClient, actor: Actor, id: string, lock = false) {
    const organizationId = member(actor);
    const row = (await client.query(`select * from whiteboards where id = $1 and organization_id = $2 ${lock ? "for update" : ""}`, [id, organizationId])).rows[0];
    if (!row) throw new WhiteboardError(404, "NOT_FOUND");
    if (row.project_id) await project(client, actor, row.project_id).catch(() => { throw new WhiteboardError(404, "NOT_FOUND"); });
    return row;
  }

  const view = (row: Record<string, any>, extra: Record<string, unknown> = {}) => ({
    id: row.id, title: row.title, projectId: row.project_id, revision: row.revision,
    elements: row.elements, appState: row.app_state, files: row.files,
    createdBy: row.created_by, updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at, ...extra,
  });

  async function list(actor: Actor, query: { projectId?: unknown }) {
    const organizationId = member(actor);
    const projectId = typeof query.projectId === "string" && query.projectId ? query.projectId : null;
    if (projectId) await project(pool, actor, projectId);
    const rows = (await pool.query(
      `select w.id, w.title, w.project_id, p.name as project_name, w.created_by, w.updated_at, w.revision,
              coalesce(u.name, u.email) as updated_by_name,
              jsonb_array_length(w.elements) as element_count
       from whiteboards w
       left join projects p on p.id = w.project_id
       left join users u on u.id = w.updated_by
       where w.organization_id = $1
         and ($2::text is null or w.project_id = $2)
         and (w.project_id is null or p.created_by = $3 or p.assigned_to = $3 or p.visibility = 'public')
       order by w.updated_at desc limit 200`, [organizationId, projectId, actor.id])).rows;
    return rows.map(row => ({
      id: row.id, title: row.title, projectId: row.project_id, projectName: row.project_name, createdBy: row.created_by,
      updatedAt: row.updated_at, updatedByName: row.updated_by_name, revision: row.revision, elementCount: row.element_count,
      canDelete: row.created_by === actor.id || canManageClients(actor),
    }));
  }

  async function create(actor: Actor, raw: unknown) {
    const organizationId = member(actor);
    if (!canEdit(actor)) throw new WhiteboardError(403, "FORBIDDEN");
    const parsed = createInput.safeParse(raw);
    if (!parsed.success) throw new WhiteboardError(400, "INVALID_REQUEST");
    if (parsed.data.projectId) await project(pool, actor, parsed.data.projectId);
    const row = (await pool.query(
      `insert into whiteboards (id, organization_id, project_id, title, created_by, updated_by) values ($1, $2, $3, $4, $5, $5) returning *`,
      [randomUUID(), organizationId, parsed.data.projectId ?? null, parsed.data.title, actor.id])).rows[0];
    return view(row);
  }

  async function get(actor: Actor, id: string) {
    const row = await load(pool, actor, id);
    return view(row, { canEdit: canEdit(actor), canDelete: row.created_by === actor.id || canManageClients(actor) });
  }

  /** Lightweight check used by open editors to pick up other people's changes. */
  async function revision(actor: Actor, id: string) {
    const row = await load(pool, actor, id);
    return { revision: row.revision, updatedAt: row.updated_at };
  }

  async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await work(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async function save(actor: Actor, id: string, raw: unknown) {
    if (!canEdit(actor)) throw new WhiteboardError(403, "FORBIDDEN");
    const parsed = saveInput.safeParse(raw);
    if (!parsed.success) throw new WhiteboardError(400, "INVALID_REQUEST");
    const input = parsed.data;
    return transaction(async client => {
      const row = await load(client, actor, id, true);
      const elements = input.elements ? mergeElements(row.elements as Element[], input.elements as Element[]) : row.elements as Element[];
      if (elements.length > LIMITS.elements) throw new WhiteboardError(413, "TOO_MANY_ELEMENTS");
      const files = input.files || input.elements ? mergeFiles(row.files, (input.files ?? {}) as Record<string, FileEntry>, elements) : row.files;
      const next = (await client.query(
        `update whiteboards set title = $2, elements = $3::jsonb, app_state = $4::jsonb, files = $5::jsonb,
           revision = revision + 1, updated_by = $6, updated_at = now() where id = $1 returning *`,
        [id, input.title ?? row.title, JSON.stringify(elements), JSON.stringify({ ...row.app_state, ...(input.appState ?? {}) }), JSON.stringify(files), actor.id])).rows[0];
      // The editor reconciles these with its own scene; file contents it already has are not sent back.
      return { revision: next.revision, title: next.title, elements, fileIds: Object.keys(files), updatedAt: next.updated_at };
    });
  }

  async function files(actor: Actor, id: string, ids: string[]) {
    const row = await load(pool, actor, id);
    return Object.fromEntries(ids.filter(fileId => row.files[fileId]).map(fileId => [fileId, row.files[fileId]]));
  }

  async function move(actor: Actor, id: string, raw: unknown) {
    const parsed = projectInput.safeParse(raw);
    if (!parsed.success) throw new WhiteboardError(400, "INVALID_REQUEST");
    return transaction(async client => {
      const row = await load(client, actor, id, true);
      if (row.created_by !== actor.id && !canManageClients(actor)) throw new WhiteboardError(403, "FORBIDDEN");
      if (parsed.data.projectId) await project(client, actor, parsed.data.projectId);
      await client.query("update whiteboards set project_id = $2, updated_at = now() where id = $1", [id, parsed.data.projectId]);
      return { id, projectId: parsed.data.projectId };
    });
  }

  async function remove(actor: Actor, id: string) {
    const row = await load(pool, actor, id);
    if (row.created_by !== actor.id && !canManageClients(actor)) throw new WhiteboardError(403, "FORBIDDEN");
    await pool.query("delete from whiteboards where id = $1 and organization_id = $2", [id, row.organization_id]);
    return { id };
  }

  return { list, create, get, revision, save, files, move, remove };
}
