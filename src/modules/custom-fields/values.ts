import { z } from "zod";

/** Field types offered for custom fields. The first five existed before; the rest came with task fields. */
export const FIELD_TYPES = ["text", "number", "date", "select", "boolean", "url", "email", "phone", "currency", "rating", "progress", "person"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const ENTITY_TYPES = ["project", "client", "task"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export type FieldDefinition = { id: string; name: string; type: string; options?: { label: string; color: string }[] | null; projectId?: string | null };

export class FieldValueError extends Error {
  constructor(public fieldId: string, public reason: string) { super(`${fieldId}: ${reason}`); }
}

const numberLike = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value.trim().replace(",", ".")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

/**
 * Normalizes one value for its field; `null` means "clear the field".
 * `members` is the organization's active user ids, needed only for person fields.
 */
export function normalizeValue(field: FieldDefinition, raw: unknown, members?: ReadonlySet<string>): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  const fail = (reason: string): never => { throw new FieldValueError(field.id, reason); };
  switch (field.type as FieldType) {
    case "text": {
      const value = String(raw).trim();
      return value.length > 2000 ? fail("too long") : value || null;
    }
    case "number":
    case "currency": {
      const value = numberLike(raw);
      if (value === null || Math.abs(value) >= 1e12) return fail("not a number");
      return field.type === "currency" ? Math.round(value * 100) / 100 : value;
    }
    case "rating": {
      const value = numberLike(raw);
      return value !== null && Number.isInteger(value) && value >= 0 && value <= 5 ? value : fail("must be 0 to 5");
    }
    case "progress": {
      const value = numberLike(raw);
      return value !== null && value >= 0 && value <= 100 ? Math.round(value) : fail("must be 0 to 100");
    }
    case "date": {
      const value = String(raw).trim().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) ? value : fail("not a date");
    }
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (["true", "1", "yes", "sim", "sí", "x", "✓"].includes(String(raw).trim().toLowerCase())) return true;
      if (["false", "0", "no", "não", "nao"].includes(String(raw).trim().toLowerCase())) return false;
      return fail("not true or false");
    case "select": {
      const label = String(raw).trim();
      const option = field.options?.find(item => item.label.toLowerCase() === label.toLowerCase());
      return option ? option.label : fail("not one of the options");
    }
    case "url": {
      const value = String(raw).trim();
      const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
      return value.length <= 2000 && z.string().url().safeParse(withScheme).success && /^https?:/i.test(withScheme) ? withScheme : fail("not a link");
    }
    case "email": {
      const value = String(raw).trim().toLowerCase();
      return z.string().email().max(200).safeParse(value).success ? value : fail("not an email");
    }
    case "phone": {
      const value = String(raw).trim();
      return /^[+\d\s().-]{3,50}$/.test(value) && /\d/.test(value) ? value : fail("not a phone number");
    }
    case "person": {
      const value = String(raw).trim();
      return members?.has(value) ? value : fail("not a member of the organization");
    }
    default:
      return fail("unknown field type");
  }
}

/** Applies a partial update (`null` clears) to stored values, keeping only fields that still exist. */
export function applyValues(stored: Record<string, unknown>, changes: Record<string, unknown>, fields: FieldDefinition[], members?: ReadonlySet<string>) {
  const byId = new Map(fields.map(field => [field.id, field]));
  const next: Record<string, unknown> = { ...stored };
  for (const [id, raw] of Object.entries(changes)) {
    const field = byId.get(id);
    if (!field) throw new FieldValueError(id, "unknown field");
    const value = normalizeValue(field, raw, members);
    if (value === null) delete next[id];
    else next[id] = value;
  }
  return next;
}

/** Best type for a spreadsheet column from its values, so imported columns get a useful field type. */
export function guessType(values: string[]): FieldType {
  const filled = values.map(value => value.trim()).filter(Boolean);
  if (!filled.length) return "text";
  const all = (test: (value: string) => boolean) => filled.every(test);
  if (all(value => /^-?\d+([.,]\d+)?$/.test(value))) return "number";
  if (all(value => /^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value))) return "date";
  if (all(value => z.string().email().safeParse(value).success)) return "email";
  if (all(value => /^https?:\/\//i.test(value))) return "url";
  const distinct = new Set(filled.map(value => value.toLowerCase()));
  if (distinct.size <= 12 && filled.length >= distinct.size * 2) return "select";
  return "text";
}

/** Day-first spreadsheet dates ("05/03/2026") become ISO; others pass through. */
export function importValue(type: FieldType, value: string) {
  const text = value.trim();
  if (type === "date") {
    const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return text;
}
