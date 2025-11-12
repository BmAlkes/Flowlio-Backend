import { migrate } from "drizzle-orm/node-postgres/migrator";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/schema/schema";
import { env } from "@/utils/env.util";
import { Pool } from "pg";

export const database = drizzle(env.CONNECTION_URL, {
  casing: "snake_case",
  schema,
});

export const connection = new Pool({ connectionString: env.CONNECTION_URL });

export const migrateSchema = async (
  db: NodePgDatabase<Record<string, unknown>>
) => await migrate(db, { migrationsFolder: "drizzle" });
