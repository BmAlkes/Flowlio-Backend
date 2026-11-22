import type { Pool } from "pg";
import { collectOrganization, loadGraph, rawQuery, type Row } from "@/modules/organization-data/graph";

/**
 * Full export of one organization's data for its owner (portability, backup before closing an account,
 * moving to another tool). Tables come from the database's own foreign keys (see organization-data/graph).
 * Credentials, tokens and secrets are removed from every row; internal backups keep them.
 */
export const EXPORT_FORMAT = "flowlio-organization-export/1";
const SECRET_KEY = /(password|token|secret|code_hash|p256dh|^auth$|backup_codes|input_hash|apply_hash|api_key)/i;
export const scrub = (rows: Row[]) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !SECRET_KEY.test(key))));

export async function exportOrganization(pool: Pool, organizationId: string) {
  const graph = await loadGraph(pool);
  const scopes = await collectOrganization(pool, organizationId, graph);
  const data = Object.fromEntries(scopes.map(scope => [scope.table, scrub(scope.rows)]));
  const organization = await rawQuery(pool, "select * from organizations where id=$1", [organizationId]);
  const members = await rawQuery(pool,
    `select u.id, u.name, u.email, u.phone, u.position, u.role, u.timezone, u.created_at, uo.role organization_role, uo.status
     from user_organizations uo join users u on u.id=uo.user_id where uo.organization_id=$1`, [organizationId]);
  return {
    format: EXPORT_FORMAT,
    generatedAt: new Date().toISOString(),
    organizationId,
    organization: scrub(organization.rows)[0] ?? null,
    members: members.rows,
    counts: Object.fromEntries(scopes.map(scope => [scope.table, scope.rows.length])),
    truncated: scopes.filter(scope => scope.truncated).map(scope => scope.table),
    data,
  };
}
