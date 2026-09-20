import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { releaseVersion, routeLabel } from "./privacy";

type Source = "api" | "ui" | "job";
export interface OperationalEvent {
  organizationId?: string | null;
  source: Source;
  code: string;
  route: string;
  correlationId: string;
  release?: string;
  status?: number;
  durationMs?: number;
}
interface Metric { scope: string; source: Source; bucket: string; count: number; errors: number; duration: number; max: number }
const duration = (value?: number) => Math.max(0, Math.min(86400000, Math.round(value || 0)));

export function createObservability(pool: Pick<Pool, "query">, warn: () => void = () => {}) {
  const pending = new Map<string, Metric>();
  let flushing = false;
  let dropped = 0;
  async function record(event: OperationalEvent) {
    try {
      await pool.query(`insert into operational_events(id,organization_id,source,code,route,correlation_id,release,status,duration_ms)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(),event.organizationId || null,event.source,
        /^[A-Z0-9_]{1,64}$/.test(event.code) ? event.code : "UNEXPECTED_ERROR",routeLabel(event.route),
        /^[a-f0-9-]{36}$/.test(event.correlationId) ? event.correlationId : randomUUID(),releaseVersion(event.release),event.status ?? null,duration(event.durationMs)]);
      return true;
    } catch { warn(); return false; }
  }
  function metric(source: Source, organizationId: string | null | undefined, failed: boolean, elapsed: number) {
    const bucket = new Date(); bucket.setUTCMinutes(0,0,0);
    const scope = organizationId || "global";
    const key = JSON.stringify([scope,source,bucket.toISOString()]);
    if (!pending.has(key) && pending.size >= 2000) { dropped++; return; }
    const entry = pending.get(key) ?? { scope,source,bucket:bucket.toISOString(),count:0,errors:0,duration:0,max:0 };
    entry.count++; entry.errors += Number(failed); entry.duration += duration(elapsed); entry.max = Math.max(entry.max,duration(elapsed));
    pending.set(key,entry);
  }
  async function flush() {
    if (flushing) return;
    flushing = true;
    const batch = [...pending.entries()]; pending.clear();
    try {
      for (const [key,item] of batch) {
        try {
          await pool.query(`insert into operational_metrics(scope,source,bucket_at,requests,errors,duration_ms,max_duration_ms)
            values($1,$2,$3,$4,$5,$6,$7) on conflict(scope,source,bucket_at) do update set
            requests=operational_metrics.requests+excluded.requests,errors=operational_metrics.errors+excluded.errors,
            duration_ms=operational_metrics.duration_ms+excluded.duration_ms,max_duration_ms=greatest(operational_metrics.max_duration_ms,excluded.max_duration_ms)`,
            [item.scope,item.source,item.bucket,item.count,item.errors,item.duration,item.max]);
        } catch {
          const next = pending.get(key);
          if (next) { next.count+=item.count; next.errors+=item.errors; next.duration+=item.duration; next.max=Math.max(next.max,item.max); }
          else if (pending.size < 2000) pending.set(key,item);
          else dropped+=item.count;
          warn();
        }
      }
    } finally { flushing=false; }
  }
  async function summary(organizationId: string | null) {
    const [events,metrics] = await Promise.all([
      pool.query(`select id,source,code,route,correlation_id as "correlationId",release,status,duration_ms as "durationMs",occurred_at as "occurredAt"
        from operational_events where ($1::text is null or organization_id=$1) and occurred_at>now()-interval '24 hours' order by occurred_at desc,id desc limit 100`,[organizationId]),
      pool.query(`select source,sum(requests)::int as requests,sum(errors)::int as errors,
        round(sum(duration_ms)::numeric/nullif(sum(requests),0))::int as "averageMs",max(max_duration_ms)::int as "maxMs"
        from operational_metrics where ($1::text is null or scope=$1) and bucket_at>=date_trunc('hour',now())-interval '23 hours' group by source`,[organizationId]),
    ]);
    return { events:events.rows, metrics:metrics.rows, retentionDays:30, windowHours:24, metricsDelaySeconds:5,
      alerts:metrics.rows.filter(row=>row.errors>=5 || row.maxMs>=10000).map(row=>({ source:row.source, code:row.errors>=5 ? "REPEATED_FAILURES" : "SLOW_OPERATION" })) };
  }
  async function prune() {
    await pool.query("delete from operational_events where id in (select id from operational_events where occurred_at<now()-interval '30 days' limit 10000)");
    await pool.query("delete from operational_metrics where bucket_at<now()-interval '30 days'");
  }
  return { record,metric,flush,summary,prune, health: () => ({ pending:pending.size,dropped }) };
}
