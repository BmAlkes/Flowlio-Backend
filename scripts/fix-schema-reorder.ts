import { database } from "../src/configs/connection.config";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Applying targeted schema changes for reordering...");
  try {
    // Add position column to clients
    await database.execute(sql`
      ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
    `);
    console.log("✓ Added 'position' column to 'clients' table");

    // Add position column to projects
    await database.execute(sql`
      ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "position" integer DEFAULT 0 NOT NULL;
    `);
    console.log("✓ Added 'position' column to 'projects' table");

    // Add index to clients
    await database.execute(sql`
      CREATE INDEX IF NOT EXISTS "clients_position_idx" ON "clients" ("position");
    `);
    console.log("✓ Created index 'clients_position_idx'");

    // Add index to projects
    await database.execute(sql`
      CREATE INDEX IF NOT EXISTS "projects_position_idx" ON "projects" ("position");
    `);
    console.log("✓ Created index 'projects_position_idx'");

    console.log("\nSuccess! Targeted schema changes applied successfully.");
  } catch (error) {
    console.error("\nFailed to apply targeted schema changes:");
    console.error(error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

run();
