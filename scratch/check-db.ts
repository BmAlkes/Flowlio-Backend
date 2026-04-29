import { database } from "../src/configs/connection.config";
import { sql } from "drizzle-orm";

async function checkColumn() {
  try {
    const res = await database.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'support_tickets' AND column_name = 'destination'
    `);
    console.log("DESTINATION_COLUMN_CHECK:", JSON.stringify(res.rows, null, 2));
    
    const allCols = await database.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'support_tickets'
    `);
    console.log("ALL_COLUMNS:", JSON.stringify(allCols.rows.map((r: any) => r.column_name), null, 2));
  } catch (err) {
    console.error("DB_ERROR:", err);
  } finally {
    process.exit(0);
  }
}

checkColumn();
