/**
 * Minimal monday.com GraphQL client. The person's API token is used for the request only:
 * it is never stored or logged.
 */
export class MondayError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

const ENDPOINT = "https://api.monday.com/v2";
export const MAX_ITEMS = 5000;

export type MondayColumn = { id: string; title: string; type: string };
export type MondayColumnValue = { id: string; type: string; text: string | null; value: string | null };
export type MondayItem = { id: string; name: string; group: { id: string; title: string } | null; column_values: MondayColumnValue[]; subitems?: Omit<MondayItem, "subitems" | "group">[] };
export type MondayBoard = { id: string; name: string; columns: MondayColumn[]; items: MondayItem[] };
export type MondayUser = { id: string; email: string; name: string };

export function mondayClient(token: string, fetchImpl: Fetch = fetch as unknown as Fetch) {
  const clean = token.trim();
  if (!/^[A-Za-z0-9._-]{20,4000}$/.test(clean)) throw new MondayError(400, "INVALID_TOKEN", "That does not look like a monday.com API token");

  async function request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: clean },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new MondayError(502, "MONDAY_UNREACHABLE", "Could not reach monday.com");
    }
    if (response.status === 401 || response.status === 403) throw new MondayError(401, "INVALID_TOKEN", "monday.com refused this token");
    if (response.status === 429) throw new MondayError(429, "RATE_LIMITED", "monday.com asked to slow down; try again in a minute");
    const body = await response.json().catch(() => null) as { data?: T; errors?: { message?: string; extensions?: { code?: string } }[]; error_message?: string; error_code?: string } | null;
    const problem = body?.errors?.[0];
    if (problem?.extensions?.code === "ComplexityException" || body?.error_code === "ComplexityException") throw new MondayError(429, "RATE_LIMITED", "monday.com asked to slow down; try again in a minute");
    if (/unauthori[sz]ed|not authenticated/i.test(problem?.message ?? body?.error_message ?? "")) throw new MondayError(401, "INVALID_TOKEN", "monday.com refused this token");
    if (!body?.data || problem || body.error_message) throw new MondayError(502, "MONDAY_ERROR", (problem?.message ?? body?.error_message ?? "Unexpected answer from monday.com").slice(0, 200));
    return body.data;
  }

  /** Boards the token can see (work boards only, not subitem boards or docs). */
  async function boards() {
    const result: { id: string; name: string; itemsCount: number; workspace: string | null }[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request<{ boards: { id: string; name: string; type: string; items_count: number | null; workspace: { name: string } | null }[] }>(
        `query ($page: Int!) { boards(limit: 100, page: $page, state: active, order_by: used_at) { id name type items_count workspace { name } } }`, { page });
      result.push(...data.boards.filter(board => board.type === "board").map(board => ({ id: String(board.id), name: board.name, itemsCount: board.items_count ?? 0, workspace: board.workspace?.name ?? null })));
      if (data.boards.length < 100) break;
    }
    return result;
  }

  const itemFields = `id name group { id title } column_values { id type text value } subitems { id name column_values { id type text value } }`;

  /** One board with all its items (and their subitems), following monday's cursor pages. */
  async function board(id: string): Promise<MondayBoard> {
    if (!/^\d{1,20}$/.test(id)) throw new MondayError(400, "INVALID_BOARD");
    const first = await request<{ boards: { id: string; name: string; columns: MondayColumn[]; items_page: { cursor: string | null; items: MondayItem[] } }[] }>(
      `query ($id: [ID!]) { boards(ids: $id) { id name columns { id title type } items_page(limit: 200) { cursor items { ${itemFields} } } } }`, { id: [id] });
    const found = first.boards[0];
    if (!found) throw new MondayError(404, "BOARD_NOT_FOUND", "Board not found or not shared with this token");
    const items = [...found.items_page.items];
    let cursor = found.items_page.cursor;
    while (cursor && items.length < MAX_ITEMS) {
      const next = await request<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
        `query ($cursor: String!) { next_items_page(limit: 200, cursor: $cursor) { cursor items { ${itemFields} } } }`, { cursor });
      items.push(...next.next_items_page.items);
      cursor = next.next_items_page.cursor;
    }
    return { id: String(found.id), name: found.name, columns: found.columns, items: items.slice(0, MAX_ITEMS) };
  }

  /** Account users, to match people columns to Flowlio members by e-mail. */
  async function users(): Promise<MondayUser[]> {
    const all: MondayUser[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await request<{ users: { id: string; email: string | null; name: string }[] }>(`query ($page: Int!) { users(limit: 200, page: $page) { id email name } }`, { page });
      all.push(...data.users.filter(user => user.email).map(user => ({ id: String(user.id), email: String(user.email).toLowerCase(), name: user.name })));
      if (data.users.length < 200) break;
    }
    return all;
  }

  return { boards, board, users };
}
