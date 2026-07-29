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

      -- follow-up note
      ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "follow_up_note" text;

      -- organization country
      ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "country" text;

      -- blog
      CREATE TABLE IF NOT EXISTS "blog_posts" (
        "id"               text PRIMARY KEY NOT NULL,
        "slug"             text NOT NULL UNIQUE,
        "title"            text NOT NULL,
        "excerpt"          text,
        "content"          text NOT NULL DEFAULT '',
        "cover_image"      text,
        "author_id"        text REFERENCES "public"."users"("id") ON DELETE SET NULL,
        "author_name"      text,
        "status"           text NOT NULL DEFAULT 'draft',
        "category"         text,
        "tags"             json DEFAULT '[]',
        "meta_title"       text,
        "meta_description" text,
        "meta_keywords"    text,
        "canonical_url"    text,
        "og_image"         text,
        "schema_markup"    json,
        "faq"              json,
        "view_count"       integer NOT NULL DEFAULT 0,
        "reading_time_min" integer,
        "featured"         boolean NOT NULL DEFAULT false,
        "published_at"     timestamp,
        "created_at"       timestamp NOT NULL DEFAULT now(),
        "updated_at"       timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "blog_posts_slug_idx"     ON "blog_posts" ("slug");
      CREATE INDEX IF NOT EXISTS "blog_posts_status_idx"   ON "blog_posts" ("status");
      CREATE INDEX IF NOT EXISTS "blog_posts_category_idx" ON "blog_posts" ("category");

      CREATE TABLE IF NOT EXISTS "blog_post_views" (
        "id"         text PRIMARY KEY NOT NULL,
        "post_id"    text NOT NULL REFERENCES "public"."blog_posts"("id") ON DELETE CASCADE,
        "ip_hash"    text,
        "referrer"   text,
        "user_agent" text,
        "country"    text,
        "created_at" timestamp NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS "blog_post_views_post_idx"  ON "blog_post_views" ("post_id");
      CREATE INDEX IF NOT EXISTS "blog_post_views_date_idx"  ON "blog_post_views" ("created_at");
    `);
  } finally {
    client.release();
  }
};
