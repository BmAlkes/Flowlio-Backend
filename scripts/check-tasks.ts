
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function checkTasks() {
    const pool = new Pool({ connectionString: process.env.CONNECTION_URL });
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'tasks';
        `);
        console.log('Columns in tasks table:');
        console.log(JSON.stringify(res.rows, null, 2));
    } finally {
        client.release();
        await pool.end();
    }
}

checkTasks().catch(console.error);
