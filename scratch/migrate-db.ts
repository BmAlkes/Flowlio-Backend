import { database } from "../src/configs/connection.config";
import { sql } from "drizzle-orm";

async function migrate() {
  try {
    console.log("Adding 'destination' column to 'support_tickets'...");
    await database.execute(sql`
      ALTER TABLE support_tickets 
      ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'platform'
    `);
    console.log("Column 'destination' added successfully.");
  } catch (err) {
    console.error("MIGRATION_ERROR:", err);
  } finally {
    process.exit(0);
  }
}

migrate();
