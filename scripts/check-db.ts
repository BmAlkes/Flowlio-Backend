
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

async function check() {
    const pool = new Pool({ connectionString: process.env.CONNECTION_URL });
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'projects';
        `);
        console.log('Columns in projects table:');
        console.table(res.rows);
    } finally {
        client.release();
        await pool.end();
    }
}

check().catch(console.error);
