import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
export type Job = {
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    scheduled_at: Date;
    attempts: number;
};
export type Handler = {
    transactional: boolean;
    retryable?: boolean;
    run: (job: Job, client: PoolClient) => Promise<void>;
};
export type Schedule = {
    kind: string;
    minutes: number;
    hour?: number;
    weekday?: number;
};
const minute = 60000;
export function nextOccurrence(schedule: Schedule, after: Date): Date {
    let time = Math.ceil(after.getTime() / minute) * minute;
    for (let i = 0; i <= 10080; i++, time += minute) {
        const date = new Date(time);
        if (schedule.hour === undefined && schedule.weekday === undefined && time / minute % schedule.minutes !== 0)
            continue;
        if ((schedule.hour !== undefined || schedule.weekday !== undefined) && date.getUTCMinutes() !== 0)
            continue;
        if (schedule.weekday !== undefined && date.getUTCDay() !== schedule.weekday)
            continue;
        if (schedule.hour !== undefined && date.getUTCHours() !== schedule.hour)
            continue;
        if (schedule.minutes === 360 && date.getUTCHours() % 6 !== 0)
            continue;
        return date;
    }
    throw new Error("Invalid job schedule: " + schedule.kind);
}
export async function enqueue(client: Pick<PoolClient, "query">, kind: string, key: string, payload: unknown = {}, scheduledAt = new Date()) {
    await client.query(`INSERT INTO durable_jobs (id,kind,dedupe_key,payload,scheduled_at,available_at)
    VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (dedupe_key) DO NOTHING`, [randomUUID(), kind, key, JSON.stringify(payload), scheduledAt]);
}
export async function scheduleDue(pool: Pool, schedules: Schedule[], now = new Date()) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        for (const schedule of schedules) {
            await client.query("INSERT INTO job_schedules (kind,next_run_at) VALUES ($1,$2) ON CONFLICT DO NOTHING", [schedule.kind, nextOccurrence(schedule, now)]);
            const result = await client.query("SELECT next_run_at,enabled,interval_minutes FROM job_schedules WHERE kind=$1 FOR UPDATE SKIP LOCKED", [schedule.kind]);
            if (!result.rows.length || !result.rows[0].enabled)
                continue;
            const active = result.rows[0].interval_minutes ? { kind: schedule.kind, minutes: result.rows[0].interval_minutes } : schedule;
            let next = new Date(result.rows[0].next_run_at);
            for (let count = 0; next <= now && count < 100; count++) {
                await enqueue(client, schedule.kind, schedule.kind + ":" + next.toISOString(), {}, next);
                next = nextOccurrence(active, new Date(next.getTime() + minute));
            }
            await client.query("UPDATE job_schedules SET next_run_at=$2 WHERE kind=$1", [schedule.kind, next]);
        }
        await client.query("COMMIT");
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
    }
}
/** Session lock spans the handler. A disconnected/crashed worker releases it in PostgreSQL. */
export async function runOne(pool: Pool, handlers: Record<string, Handler>, onConnectionLost: (error: Error) => void): Promise<boolean> {
    const candidates = await pool.query<Job>(`SELECT * FROM (
      SELECT DISTINCT ON (kind) id,kind,payload,scheduled_at,attempts,available_at FROM durable_jobs
      WHERE status IN ('pending','running','retry') AND available_at <= now() AND kind = ANY($1)
      ORDER BY kind,available_at,id
    ) due ORDER BY available_at,id LIMIT 30`, [Object.keys(handlers)]);
    for (const candidate of candidates.rows) {
        const client = await pool.connect();
        let locked = false;
        client.on("error", onConnectionLost);
        try {
            locked = (await client.query("SELECT pg_try_advisory_lock(601000,hashtext($1)) AS locked", [candidate.kind])).rows[0].locked;
            if (!locked)
                continue;
            await client.query("BEGIN");
            const result = await client.query("SELECT * FROM durable_jobs WHERE id=$1 AND status IN ('pending','running','retry') AND available_at<=now() FOR UPDATE", [candidate.id]);
            if (!result.rows.length) {
                await client.query("COMMIT");
                continue;
            }
            const job = result.rows[0];
            const handler = handlers[job.kind];
            if (job.status === "running" && (!handler.transactional || handler.retryable === false)) {
                await client.query("UPDATE durable_jobs SET status='uncertain',last_error='Worker interrupted during external operation',finished_at=now() WHERE id=$1", [job.id]);
                await client.query("COMMIT");
                return true;
            }
            if (job.attempts >= 5) {
                await client.query("UPDATE durable_jobs SET status='failed',finished_at=now() WHERE id=$1", [job.id]);
                await client.query("COMMIT");
                return true;
            }
            await client.query("UPDATE durable_jobs SET status='running',attempts=attempts+1,started_at=now() WHERE id=$1", [job.id]);
            await client.query("COMMIT");
            try {
                if (handler.transactional) {
                    await client.query("BEGIN");
                    await client.query("SET LOCAL lock_timeout='15s'");
                    await client.query("SET LOCAL statement_timeout='120s'");
                }
                await handler.run(job, client);
                await client.query("UPDATE durable_jobs SET status='completed',finished_at=now(),last_error=NULL,payload='{}'::json WHERE id=$1", [job.id]);
                if (handler.transactional)
                    await client.query("COMMIT");
            }
            catch (error) {
                if (handler.transactional)
                    await client.query("ROLLBACK");
                const status = (!handler.transactional || handler.retryable === false) ? "uncertain" : job.attempts + 1 >= 5 ? "failed" : "retry";
                await client.query(`UPDATE durable_jobs SET status=$2,last_error=$3,
          available_at=now()+($4 * interval '1 second'),finished_at=CASE WHEN $2='retry' THEN NULL ELSE now() END WHERE id=$1`, [job.id, status, error instanceof Error ? error.name : "Job error", Math.min(3600, 30 * 2 ** job.attempts)]);
            }
            return true;
        }
        catch (error) {
            await client.query("ROLLBACK").catch(() => { });
            throw error;
        }
        finally {
            if (locked) {
                try {
                    await client.query("SELECT pg_advisory_unlock(601000,hashtext($1))", [candidate.kind]);
                }
                catch { /* disconnected sessions release their locks */ }
            }
            client.removeListener("error", onConnectionLost);
            client.release();
        }
    }
    return false;
}
