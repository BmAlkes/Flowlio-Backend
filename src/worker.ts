if (__dirname.includes("dist"))
    require("module-alias/register");
import { observability, startTelemetryFlush } from "./modules/observability/runtime";
import { setTimeout as delay } from "node:timers/promises";
import { connection } from "./configs/connection.config";
import { runReleaseMigrations } from "./utils/release-migrations.util";
import { scheduleDue, runOne } from "./services/jobs/queue";
import { handlers, schedules } from "./services/jobs/handlers";
import { logger } from "./utils/logger.util";
let stopping = false;
const abort = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => { stopping = true; abort.abort(); });
async function main() {
    await runReleaseMigrations(connection);
    await connection.query("INSERT INTO job_schedules(kind,next_run_at,enabled) VALUES ('calendar-sync',date_trunc('hour',now())+interval '1 hour',$1) ON CONFLICT DO NOTHING", [process.env.ENABLE_BACKGROUND_SYNC !== "false"]);
    logger.info("Durable worker ready");
    const telemetryTimer = startTelemetryFlush();
    let nextPrune = 0;
    try {
        while (!stopping) {
            if (Date.now() >= nextPrune) {
                await observability.prune().catch(() => logger.warn("Telemetry retention cleanup failed"));
                nextPrune = Date.now() + 3600000;
            }
            await scheduleDue(connection, schedules);
            const watchdog = setTimeout(() => { logger.error("Worker job exceeded 10 minutes; stopping for recovery"); process.exit(1); }, 600000);
            let worked: boolean;
            try {
                worked = await runOne(connection, handlers, () => process.exit(1), async (job, outcome, durationMs) => {
                    const organizationId = typeof job.payload.organizationId === "string" ? job.payload.organizationId : null;
                    observability.metric("job", organizationId, outcome !== "completed", durationMs);
                    if (outcome !== "completed") await observability.record({ source:"job", organizationId,code:"JOB_"+outcome.toUpperCase(),route:job.kind,correlationId:job.id,durationMs });
                });
            }
            finally {
                clearTimeout(watchdog);
            }
            if (!worked)
                await delay(2000, undefined, { signal: abort.signal }).catch(() => { });
        }
    }
    finally {
        clearInterval(telemetryTimer);
        await observability.flush();
        await connection.end();
    }
}
void main().catch(error => { logger.error("Durable worker stopped", error); process.exit(1); });
