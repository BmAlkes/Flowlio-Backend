
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function bruteSync() {
    const pool = new Pool({ connectionString: process.env.CONNECTION_URL });
    const client = await pool.connect();
    try {
        console.log("Starting brute-force sync of missing columns...");

        const tables = [
            {
                name: 'projects',
                columns: [
                    ['project_number', 'text'],
                    ['client_id', 'text'],
                    ['description', 'text'],
                    ['organization_id', 'text'],
                    ['created_by', 'text'],
                    ['assigned_to', 'text'],
                    ['status', 'text'],
                    ['visibility', "text DEFAULT 'private'"],
                    ['start_date', 'timestamp'],
                    ['end_date', 'timestamp'],
                    ['progress', 'integer'],
                    ['address', 'text'],
                    ['budget', 'numeric(10, 2)'],
                    ['contractfile', 'text'],
                    ['contractfile_public_id', 'text'],
                    ['project_files', 'json'],
                    ['tags', 'json'],
                    ['custom_fields', 'json'],
                    ['settings', 'json']
                ]
            },
            {
                name: 'tasks',
                columns: [
                    ['title', 'text'],
                    ['description', 'text'],
                    ['project_id', 'text'],
                    ['assigned_to', 'text'],
                    ['created_by', 'text'],
                    ['status', 'text'],
                    ['visibility', "text DEFAULT 'private'"],
                    ['end_date', 'timestamp'],
                    ['start_after', 'text'],
                    ['finish_before', 'text'],
                    ['start_date', 'timestamp'],
                    ['estimated_hours', 'numeric(10, 2)'],
                    ['actual_hours', 'numeric(10, 2)'],
                    ['attachments', 'json'],
                    ['parent_id', 'text'],
                    ['created_at', 'timestamp DEFAULT now()'],
                    ['updated_at', 'timestamp DEFAULT now()']
                ]
            },
            {
                name: 'users',
                columns: [
                    ['is_super_admin', 'boolean DEFAULT false'],
                    ['subadmin_id', 'text'],
                    ['selected_plan_id', 'text']
                ]
            }
        ];

        for (const table of tables) {
            console.log(`Checking table ${table.name}...`);
            for (const [col, type] of table.columns) {
                try {
                    await client.query(`ALTER TABLE "${table.name}" ADD COLUMN IF NOT EXISTS "${col}" ${type};`);
                } catch (e) {
                    console.error(`Failed to add ${col} to ${table.name}: ${e.message}`);
                }
            }
        }

        // Create missing tables
        console.log("Checking for missing tables...");
        const missingTables = [
            `CREATE TABLE IF NOT EXISTS "project_expenses" (
                "id" text PRIMARY KEY NOT NULL,
                "project_id" text NOT NULL,
                "amount" numeric(10, 2) NOT NULL,
                "category" text NOT NULL,
                "description" text NOT NULL,
                "date" timestamp NOT NULL,
                "created_by" text NOT NULL,
                "created_at" timestamp DEFAULT now(),
                "updated_at" timestamp DEFAULT now()
            );`,
            `CREATE TABLE IF NOT EXISTS "files" (
                "id" text PRIMARY KEY NOT NULL,
                "name" text NOT NULL,
                "organization_id" text NOT NULL,
                "project_id" text,
                "task_id" text,
                "client_id" text,
                "uploaded_by" text NOT NULL,
                "created_at" timestamp DEFAULT now(),
                "updated_at" timestamp DEFAULT now()
            );`,
            `CREATE TABLE IF NOT EXISTS "file_versions" (
                "id" text PRIMARY KEY NOT NULL,
                "file_id" text NOT NULL,
                "url" text NOT NULL,
                "name" text NOT NULL,
                "size" integer NOT NULL,
                "type" text NOT NULL,
                "version_number" integer NOT NULL,
                "uploaded_by" text NOT NULL,
                "created_at" timestamp DEFAULT now()
            );`
        ];

        for (const sql of missingTables) {
            try {
                await client.query(sql);
            } catch (e) {
                console.error(`Failed to create table: ${e.message}`);
            }
        }

        console.log("Brute-force sync completed.");
    } finally {
        client.release();
        await pool.end();
    }
}

bruteSync().catch(console.error);
