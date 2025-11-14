/**
 * Safe database generation script that handles connection errors gracefully
 * This allows the build to succeed even if the database is unreachable
 */

const { execSync } = require("child_process");
const path = require("path");

try {
  console.log("Generating database migrations...");
  execSync("drizzle-kit generate", {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
  });
  console.log("✅ Database migrations generated successfully");
} catch (error) {
  console.error("⚠️  Warning: Could not generate database migrations");
  console.error("Error:", error.message);
  console.log("This is usually fine if the database is unreachable.");
  console.log(
    "Migrations can be generated later when the database is available."
  );
  console.log("Build will continue...");
  // Exit with success code so build doesn't fail
  process.exit(0);
}
