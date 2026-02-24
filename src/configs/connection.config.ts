import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/schema/schema";
import { env } from "@/utils/env.util";
import { Pool } from "pg";
import { logger } from "@/utils/logger.util";

// Optimized connection pool configuration for enterprise-level performance
export const connection = new Pool({
  connectionString: env.CONNECTION_URL,
  max: 20, // Maximum number of clients in the pool
  min: 5, // Minimum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 15000, // Return error after 15s (cloud DBs like Neon need longer for first connect)
  allowExitOnIdle: true, // Allow process to exit if pool is idle
});

// Log pool events for monitoring
connection.on("connect", () => {
  logger.debug("New database client connected");
});

connection.on("error", (err) => {
  logger.error("Database pool error:", err);
});

connection.on("remove", () => {
  logger.debug("Database client removed from pool");
});

export const database = drizzle(connection, {
  casing: "snake_case",
  schema,
});

export const migrateSchema = async (
  db: NodePgDatabase<Record<string, unknown>>
) => await migrate(db, { migrationsFolder: "drizzle" });
