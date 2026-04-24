
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function addColumns() {
    const pool = new Pool({ connectionString: process.env.CONNECTION_URL });
    const client = await pool.connect();
    try {
        console.log("Adding budget column...");
        await client.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "budget" numeric(10, 2);`);
        console.log("Adding visibility column...");
        await client.query(`ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visibility" text DEFAULT 'private';`);
        
        console.log("Adding project_expenses table...");
        await client.query(`
            CREATE TABLE IF NOT EXISTS "project_expenses" (
                "id" text PRIMARY KEY NOT NULL,
                "project_id" text NOT NULL,
                "amount" numeric(10, 2) NOT NULL,
                "category" text NOT NULL,
                "description" text NOT NULL,
                "date" timestamp NOT NULL,
                "created_by" text NOT NULL,
                "created_at" timestamp NOT NULL,
                "updated_at" timestamp NOT NULL
            );
        `);
        
        console.log("Success! Columns and tables added manually.");
    } catch (error) {
        console.error("Failed to add columns manually:");
        console.error(error);
    } finally {
        client.release();
        await pool.end();
    }
}

addColumns().catch(console.error);
