import { z } from "zod";
import type { RequestHandler } from "express";

const integer = (max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(max));
const querySchema = z.object({
  page: integer(100000).optional(),
  pageSize: integer(200).optional(),
  search: z.string().max(200).optional(),
  status: z.string().max(40).optional(),
  projectId: z.string().max(100).optional(),
  assignedTo: z.string().max(100).optional(),
});
export function readListQuery(query: unknown) { return querySchema.parse(query ?? {}); }
export const validateListQuery: RequestHandler = (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ success: false, code: "INVALID_QUERY", message: "Invalid list filters or pagination" });
    return;
  }
  next();
};
export function listPage(query: unknown) {
  const parsed = readListQuery(query);
  if (parsed.page === undefined && parsed.pageSize === undefined) return undefined;
  const page = parsed.page ?? 1;
  const pageSize = parsed.pageSize ?? 100;
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export function pageResult<T>(rows: T[], page?: ReturnType<typeof listPage>) {
  if (!page) return { data: rows };
  return { data: rows.slice(0, page.pageSize), pagination: {
    page: page.page, pageSize: page.pageSize, hasMore: rows.length > page.pageSize,
  } };
}
/** LIKE metacharacters must be literal user text, not wildcard filters. */
export function containsText(value: string) { return `%${value.replace(/[\\%_]/g, "\\$&")}%`; }
