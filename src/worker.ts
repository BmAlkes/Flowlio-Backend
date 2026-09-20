if (__dirname.includes("dist"))
    require("module-alias/register");
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
    try {
        while (!stopping) {
            await scheduleDue(connection, schedules);
            const watchdog = setTimeout(() => { logger.error("Worker job exceeded 10 minutes; stopping for recovery"); process.exit(1); }, 600000);
            let worked: boolean;
            try {
                worked = await runOne(connection, handlers, () => process.exit(1));
            }
            finally {
                clearTimeout(watchdog);
            }
            if (!worked)
                await delay(2000, undefined, { signal: abort.signal }).catch(() => { });
        }
    }
    finally {
        await connection.end();
    }
}
void main().catch(error => { logger.error("Durable worker stopped", error); process.exit(1); });
