// Loaded before application imports: CI never reads production .env values.
const Module = require("node:module");
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === "dotenv") return { config: () => ({ parsed: {} }) };
  return load.call(this, name, ...args);
};
const values = {
  NODE_ENV: "test", DATABASE_NAME: "flowlio_ci_unused",
  CONNECTION_URL: "postgres://postgres:flowlio_local_test@127.0.0.1:55442/flowlio_ci_unused",
  FRONTEND_DOMAIN: "http://127.0.0.1:4000", BACKEND_DOMAIN: "http://127.0.0.1:3333",
  BETTER_AUTH_SECRET: "flowlio-test-only-secret-with-at-least-32-characters",
  COOKIE_SECRET: "flowlio-test-only-cookie", JWT_SECRET: "flowlio-test-only-jwt",
  CLOUDINARY_API_SECRET: "test", CLOUDINARY_CLOUD_NAME: "test", CLOUDINARY_API_KEY: "test",
  GOOGLE_CLIENT_SECRET: "test", GOOGLE_CLIENT_ID: "test", GOOGLE_REDIRECT_URI: "http://127.0.0.1:3333/callback",
  BREVO_API_KEY: "test", BREVO_SENDER: "test@example.test", PAYPAL_MODE: "sandbox",
  PAYPAL_CLIENT_ID: "test", PAYPAL_CLIENT_SECRET: "test", PAYPAL_WEBHOOK_ID: "test",
  OPEN_AI: "test", ENABLE_BACKGROUND_SYNC: "false",
};
Object.assign(process.env, values);
const databases = {
  CAPACITY_TEST_DATABASE_URL: [55442, "flowlio_capacity_test"],
  DELIVERY_TEST_DATABASE_URL: [55442, "flowlio_delivery_test"],
  PROFITABILITY_TEST_DATABASE_URL: [55442, "flowlio_profitability_test"],
  PROPOSAL_PROJECT_TEST_DATABASE_URL: [55442, "flowlio_proposal_project_test"],
  AI_TEST_DATABASE_URL: [55442, "flowlio_ai_test"],
  INVOICE_TEST_DATABASE_URL: [55442, "flowlio_invoice_test"],
  TIME_INVOICE_TEST_DATABASE_URL: [55442, "flowlio_time_invoice_test"],
  TIMER_TEST_DATABASE_URL: [55442, "flowlio_timer_test"],
  RELEASE_TEST_DATABASE_URL: [55439, "flowlio_migration_test"],
  JOBS_TEST_DATABASE_URL: [55440, "flowlio_jobs_test"],
  DATA_ACCESS_TEST_DATABASE_URL: [55442, "flowlio_data_access_test"],
  OBSERVABILITY_TEST_DATABASE_URL: [55442, "flowlio_observability_test"],
};
for (const [key, [port, database]] of Object.entries(databases)) {
  process.env[key] = `postgres://postgres:flowlio_local_test@127.0.0.1:${port}/${database}`;
}
module.exports = { databases };
