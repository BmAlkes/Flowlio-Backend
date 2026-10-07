import { createHash } from "node:crypto";
import type { Pool } from "pg";

// Claim before Better Auth creates/replaces the code, not in the mail callback.
// A primary-key conflict makes simultaneous requests safe across HTTP replicas.
export async function claimLoginOtpSend(db: Pick<Pool, "query">, challenge: string) {
  const id = "login-otp-send:" + createHash("sha256").update(challenge).digest("hex");
  const result = await db.query(`
    insert into verification (id, identifier, value, expires_at, created_at, updated_at)
    values ($1, $1, 'send-cooldown', now() + interval '60 seconds', now(), now())
    on conflict (id) do update set expires_at = excluded.expires_at, updated_at = excluded.updated_at
    where verification.expires_at <= now()
    returning id`, [id]);
  return result.rowCount === 1;
}
