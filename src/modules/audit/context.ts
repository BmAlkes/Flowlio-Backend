import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { PoolClient } from "pg";

export interface AuditContext {
  organizationId: string;
  actorKind: "human" | "system";
  actorId: string;
  operationId?: string;
}
function serialize(context: AuditContext): string {
  if (!context.organizationId || !context.actorId) throw new Error("Audit identity required");
  return JSON.stringify({ ...context, operationId: context.operationId ?? randomUUID() });
}
// Call only inside the transaction that performs the mutation. Transaction-local
// settings cannot leak through the connection pool to another request/tenant.
export async function setAuditContext(client: PoolClient, context: AuditContext) {
  await client.query("select set_config('flowlio.audit_context', $1, true)", [serialize(context)]);
}
export async function setDrizzleAuditContext(tx: { execute: (query: SQL) => Promise<unknown> }, context: AuditContext) {
  await tx.execute(sql`select set_config('flowlio.audit_context', ${serialize(context)}, true)`);
}
