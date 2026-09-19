import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: { url: process.env.CONNECTION_URL ?? "" },
  schema: "./src/schema/schema.ts",
  casing: "snake_case",
  dialect: "postgresql",
  out: "./drizzle/releases",
  verbose: true,
  strict: true,
});
