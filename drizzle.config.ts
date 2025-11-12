import { defineConfig, type Config } from "drizzle-kit";
import { env } from "./src/utils/env.util";

export default defineConfig({
  dbCredentials: {
    url: env.CONNECTION_URL,
  },
  schema: "./src/schema/schema.ts",
  dialect: "postgresql",
  out: "./drizzle",
  verbose: true,
  strict: true,
});
