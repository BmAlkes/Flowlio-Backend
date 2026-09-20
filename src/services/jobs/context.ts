import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolClient } from "pg";
import type * as schema from "../../schema/schema";
import type { Job } from "./queue";
export const jobContext = new AsyncLocalStorage<{
    job: Job;
    client: PoolClient;
    database: NodePgDatabase<typeof schema>;
}>();
export function scopedDatabase(base: NodePgDatabase<typeof schema>): NodePgDatabase<typeof schema> {
    return new Proxy(base, {
        get(target, property) {
            const context = jobContext.getStore();
            const active = context?.database ?? target;
            if (context && property === "transaction")
                return async (callback: (tx: NodePgDatabase<typeof schema>) => Promise<unknown>) => {
                    const savepoint = "job_" + randomUUID().replace(/-/g, "");
                    await context.client.query("SAVEPOINT " + savepoint);
                    try {
                        const result = await callback(scopedDatabase(active));
                        await context.client.query("RELEASE SAVEPOINT " + savepoint);
                        return result;
                    }
                    catch (error) {
                        await context.client.query("ROLLBACK TO SAVEPOINT " + savepoint);
                        throw error;
                    }
                };
            const value = Reflect.get(active, property);
            return typeof value === "function" ? value.bind(active) : value;
        }
    });
}
