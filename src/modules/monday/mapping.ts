import type { FieldType } from "../custom-fields/values";
import type { MondayBoard, MondayColumn, MondayColumnValue, MondayItem, MondayUser } from "./client";

/** How each monday column lands in Flowlio: a task property, a custom field, or nothing. */
export type ColumnPlan =
  | { column: MondayColumn; role: "status" | "assignee" | "due" | "timeline" | "description" }
  | { column: MondayColumn; role: "field"; type: FieldType }
  | { column: MondayColumn; role: "skip" };

export type MappedTask = {
  externalId: string;
  parentExternalId: string | null;
  title: string;
  status: string | null;
  assigneeEmail: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  values: Record<string, string>;
};

export type MappedBoard = {
  name: string;
  plan: ColumnPlan[];
  /** Custom fields to create on the project, with the labels found for list fields. */
  fields: { name: string; type: FieldType; options?: string[] }[];
  tasks: MappedTask[];
  unmatchedPeople: string[];
};

const FIELD_TYPES: Record<string, FieldType> = {
  status: "select", color: "select", dropdown: "text", text: "text", long_text: "text", numbers: "number", numeric: "number",
  date: "date", email: "email", phone: "phone", link: "url", checkbox: "boolean", rating: "rating", tags: "text", country: "text",
  hour: "text", week: "text", location: "text", people: "text", multiple_person: "text", timeline: "text",
};
const SKIP = new Set(["subtasks", "subitems", "file", "board_relation", "mirror", "lookup", "formula", "creation_log", "last_updated", "item_id", "button", "dependency", "auto_number", "vote", "progress", "time_tracking", "color_picker", "name", "doc", "direct_doc", "item_assignees", "integration"]);
const GROUP_FIELD = "Grupo";

const norm = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const isType = (column: MondayColumn, ...types: string[]) => types.includes(column.type.replace("-", "_"));

/** Picks the task's status, assignee, dates and description columns; everything else becomes a field. */
export function planColumns(columns: MondayColumn[]): ColumnPlan[] {
  const pick = (types: string[], hints: RegExp) => {
    const candidates = columns.filter(column => isType(column, ...types));
    return candidates.find(column => hints.test(norm(column.title))) ?? candidates[0];
  };
  const status = pick(["status", "color"], /status|estado|situac|stage|etapa/);
  const assignee = pick(["people", "multiple_person", "person"], /owner|person|respons|assign|dono/);
  const due = pick(["date"], /due|prazo|deadline|entrega|vencimento|fecha|data/);
  const timeline = pick(["timeline", "timerange"], /timeline|cronograma|periodo/);
  const description = pick(["long_text"], /desc|nota|note|detal|brief/);
  return columns.map(column => {
    if (column === status) return { column, role: "status" };
    if (column === assignee) return { column, role: "assignee" };
    if (column === due) return { column, role: "due" };
    if (column === timeline) return { column, role: "timeline" };
    if (column === description) return { column, role: "description" };
    const type = FIELD_TYPES[column.type.replace("-", "_")];
    if (SKIP.has(column.type) || !type) return { column, role: "skip" };
    return { column, role: "field", type };
  });
}

const json = (value: string | null) => { try { return value ? JSON.parse(value) as Record<string, unknown> : null; } catch { return null; } };
const isoDate = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

/** The text Flowlio stores for a field, taken from monday's raw value when the display text is not enough. */
function fieldText(type: FieldType, cell: MondayColumnValue) {
  const raw = json(cell.value);
  if (type === "email") return String(raw?.email ?? cell.text ?? "").trim();
  if (type === "url") return String(raw?.url ?? cell.text ?? "").trim();
  if (type === "phone") return String(raw?.phone ?? cell.text ?? "").trim();
  if (type === "date") return isoDate(raw?.date) ?? (cell.text ?? "").slice(0, 10);
  if (type === "boolean") return raw?.checked === true || raw?.checked === "true" ? "true" : "";
  if (type === "rating") return raw?.rating != null ? String(raw.rating) : cell.text ?? "";
  return (cell.text ?? "").trim();
}

function personEmails(cell: MondayColumnValue | undefined, users: Map<string, MondayUser>) {
  const raw = json(cell?.value ?? null) as { personsAndTeams?: { id: number | string; kind: string }[] } | null;
  return (raw?.personsAndTeams ?? []).filter(entry => entry.kind === "person").map(entry => users.get(String(entry.id))).filter((user): user is MondayUser => !!user);
}

export function mapBoard(board: MondayBoard, mondayUsers: MondayUser[], memberEmails: ReadonlySet<string>): MappedBoard {
  const plan = planColumns(board.columns);
  const users = new Map(mondayUsers.map(user => [user.id, user]));
  const byRole = (role: ColumnPlan["role"]) => plan.find(entry => entry.role === role)?.column.id;
  const unmatched = new Set<string>();
  const fieldPlans = plan.filter((entry): entry is Extract<ColumnPlan, { role: "field" }> => entry.role === "field");
  const hasGroups = new Set(board.items.map(item => item.group?.title).filter(Boolean)).size > 1;

  const mapItem = (item: Omit<MondayItem, "subitems" | "group"> & { group?: MondayItem["group"] }, parent: string | null): MappedTask => {
    const cells = new Map(item.column_values.map(cell => [cell.id, cell]));
    const cell = (id?: string) => (id ? cells.get(id) : undefined);
    const people = personEmails(cell(byRole("assignee")), users);
    const assignee = people.find(person => memberEmails.has(person.email));
    if (!assignee) people.forEach(person => unmatched.add(person.name || person.email));
    const timeline = json(cell(byRole("timeline"))?.value ?? null);
    const dueRaw = json(cell(byRole("due"))?.value ?? null);
    const values: Record<string, string> = {};
    for (const entry of fieldPlans) {
      const found = cells.get(entry.column.id);
      const text = found ? fieldText(entry.type, found) : "";
      if (text) values[entry.column.title] = text;
    }
    if (hasGroups && item.group?.title && !parent) values[GROUP_FIELD] = item.group.title;
    return {
      externalId: String(item.id),
      parentExternalId: parent,
      title: (item.name || "").trim().slice(0, 500) || "(sem título)",
      status: cell(byRole("status"))?.text?.trim() || null,
      assigneeEmail: assignee?.email ?? null,
      startDate: isoDate(timeline?.from),
      endDate: isoDate(dueRaw?.date) ?? isoDate(timeline?.to),
      description: cell(byRole("description"))?.text?.trim().slice(0, 5000) || null,
      values,
    };
  };

  const tasks = board.items.flatMap(item => [mapItem(item, null), ...(item.subitems ?? []).map(sub => mapItem(sub, String(item.id)))]);

  // Field types come from monday's column types; list fields get every label seen in the board.
  const fields = fieldPlans.map(entry => {
    const labels = entry.type === "select" ? [...new Set(tasks.map(task => task.values[entry.column.title]).filter(Boolean))] : undefined;
    return { name: entry.column.title, type: entry.type, options: labels };
  }).filter(field => field.type !== "select" || field.options?.length);
  if (hasGroups) fields.unshift({ name: GROUP_FIELD, type: "select", options: [...new Set(board.items.map(item => item.group?.title).filter((title): title is string => !!title))] });

  return { name: board.name, plan, fields, tasks, unmatchedPeople: [...unmatched].slice(0, 50) };
}
