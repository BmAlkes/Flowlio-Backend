
import { database, migrateSchema } from "../src/configs/connection.config";
import * as dotenv from "dotenv";
dotenv.config();

async function run() {
    console.log("Starting migrations...");
    try {
        await migrateSchema(database);
        console.log("Migrations completed successfully!");
    } catch (error) {
        console.error("Migration failed:");
        console.error(error);
        process.exit(1);
    } finally {
        // The pool might still have active connections
        process.exit(0);
    }
}

run();
