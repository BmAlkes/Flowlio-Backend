
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function fixTasks() {
    const pool = new Pool({ connectionString: process.env.CONNECTION_URL });
    const client = await pool.connect();
    try {
        console.log("Adding missing columns to tasks...");
        
        // Add all columns from schema that might be missing
        const queries = [
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "project_id" text;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "assigned_to" text;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_by" text;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "status" text;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private';`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "end_date" timestamp;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "start_date" timestamp;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "estimated_hours" numeric(10, 2);`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "actual_hours" numeric(10, 2);`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "attachments" json;`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now();`,
            `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now();`
        ];

        for (const query of queries) {
            try {
                await client.query(query);
            } catch (e) {
                console.error(`Failed to run query: ${query}`);
                console.error(e);
            }
        }
        
        console.log("Success! Tasks table columns checked/added.");
    } finally {
        client.release();
        await pool.end();
    }
}

fixTasks().catch(console.error);
