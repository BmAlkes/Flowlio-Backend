import * as Sentry from "@sentry/node";
import { config } from "dotenv";
import { redactLog, redactText, releaseVersion } from "../modules/observability/privacy";

config();

// Error reporting stays off until SENTRY_DSN is set (Railway variable), so local runs and tests send nothing.
const dsn = process.env.SENTRY_DSN;
export const sentryEnabled = Boolean(dsn);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.NODE_ENV ?? "development",
    release: releaseVersion(),
    // Errors only: no performance tracing, and no user info, cookies, headers, query strings or bodies.
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [] },
  });
}

// The same redaction as the logs: emails, tokens and secrets never leave the server.
function redactedError(error: Error) {
  const safe = new Error(redactText(error.message));
  safe.name = error.name;
  safe.stack = error.stack ? redactText(error.stack) : undefined;
  return safe;
}

/** Sends one logged error to Sentry: the Error found in the log arguments, or the message itself. */
export function reportLoggedError(args: unknown[], context?: Record<string, string>) {
  if (!dsn) return;
  try {
    const error = args.find((arg): arg is Error => arg instanceof Error)
      ?? args.flatMap(arg => (arg && typeof arg === "object" ? Object.values(arg) : [])).find((v): v is Error => v instanceof Error);
    const message = args.find((arg): arg is string => typeof arg === "string");
    const extra = { log: redactLog(args.filter(arg => !(arg instanceof Error))) };
    const tags = context ? { correlationId: context.correlationId } : undefined;
    if (error) Sentry.captureException(redactedError(error), { extra: { ...extra, message: message && redactText(message) }, tags });
    else Sentry.captureMessage(redactText(message ?? "Logged error"), { level: "error", extra, tags });
  } catch {
    // Reporting must never break the request that logged the error.
  }
}
