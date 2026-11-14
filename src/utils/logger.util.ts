import { requestContext } from "../modules/observability/context";
import { redactLog } from "../modules/observability/privacy";
import { reportLoggedError } from "../configs/sentry.config";
import log from "pino";

const isProduction = process.env.NODE_ENV === "production";
const isRailway = process.env.RAILWAY_ENVIRONMENT === "production" || !!process.env.RAILWAY_PROJECT_ID;

export const logger = log({
  mixin: () => requestContext.getStore() ?? {},
  hooks: {
    logMethod(args, method, level) {
      // error (50) and fatal (60) also go to Sentry, when it is configured.
      if (level >= 50) reportLoggedError(args, requestContext.getStore());
      return method.apply(this, args.map(value => redactLog(value)) as typeof args);
    },
  },
  level: isProduction || isRailway ? "warn" : "info", // Only log warnings and errors in production
  base: {
    pid: false,
  },
  transport: isProduction || isRailway ? undefined : { // Disable pretty printing in production
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname", // Ignore unnecessary fields
    },
  },
});
