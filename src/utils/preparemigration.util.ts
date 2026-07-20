import { database, migrateSchema, connection } from "@/configs/connection.config";
import { logger } from "./logger.util";

/**
 * @param enableMigration
 * Make sure to pass true before pushing it to production.
 */

export const prepareMigration = async (enableMigration = false) => {
  if (!enableMigration) return null;
  try {
    await migrateSchema(database);
    logger.info("migration successful.");
  } catch (e) {
    const error = e as Error;
    logger.error(`migration failure: ${error.message}`);
    logger.warn('make sure to run the command "npm run dbgenerate".');
  }

  // Apply any pending schema patches via raw SQL (IF NOT EXISTS makes these idempotent).
  // This is a safety net for when Drizzle's migration system skips entries.
  try {
    await applySchemaPatches();
    logger.info("Schema patches applied.");
  } catch (e) {
    const error = e as Error;
    logger.error(`Schema patch failure: ${error.message}`);
  }
};

const applySchemaPatches = async () => {
  const client = await connection.connect();
  try {
    await client.query(`
      -- push_subscriptions table
      CREATE TABLE IF NOT EXISTS "push_subscriptions" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
        "endpoint" text NOT NULL UNIQUE,
        "p256dh" text NOT NULL,
        "auth" text NOT NULL,
        "created_at" timestamp NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");

      -- proposal signature columns
      ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_name" text;
      ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signature_image" text;
      ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "signed_ip" text;

      -- client portal access
      ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "portal_access_enabled" boolean NOT NULL DEFAULT true;
    `);
  } finally {
    client.release();
  }
};
