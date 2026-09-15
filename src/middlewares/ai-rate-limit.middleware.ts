import { Request, Response, NextFunction } from "express";
import { RateLimiterPostgres, RateLimiterRes } from "rate-limiter-flexible";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";

type Limiter = { consume(key: string): Promise<RateLimiterRes> };
export type AILimiters = Record<"userMinute" | "userImages" | "orgMinute" | "orgHour", Limiter>;

// Reuse the application's existing throttle table; no schema migration or memory fallback.
const sharedLimiter = (keyPrefix: string, points: number, duration: number) =>
  new RateLimiterPostgres({
    storeClient: connection, storeType: "pg", tableName: "throttle",
    tableCreated: true, clearExpiredByTimeout: false, keyPrefix, points, duration,
  });

export function createAIRateLimit(limiters: AILimiters) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user?.id) {
      res.status(401).json({ success: false, error: "AUTHENTICATION_REQUIRED" });
      return;
    }
    if (!user.organizationId) {
      res.status(403).json({ success: false, error: "ORGANIZATION_REQUIRED" });
      return;
    }
    if (user.role === "superadmin" || user.isSuperAdmin === true) { next(); return; }

    try {
      // consume rejects only AFTER the configured allowance is exhausted.
      // These are attempt limits: a later rejection does not refund earlier counters.
      await limiters.userMinute.consume(user.id);
      await limiters.orgMinute.consume(user.organizationId);
      await limiters.orgHour.consume(user.organizationId);
      if (req.path.endsWith("/generate-image")) await limiters.userImages.consume(user.id);
      next();
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        const retryAfter = Math.max(1, Math.ceil(error.msBeforeNext / 1000));
        res.set("Retry-After", String(retryAfter)).status(429).json({
          success: false, error: "RATE_LIMITED",
          message: "Too many AI requests. Please wait a moment.", retryAfter,
        });
      } else {
        logger.error("AI rate limit storage unavailable", error);
        res.status(503).json({ success: false, error: "SERVICE_UNAVAILABLE",
          message: "Unable to verify AI limits. Please try again." });
      }
    }
  };
}

export const aiRateLimit = createAIRateLimit({
  userMinute: sharedLimiter("ai-user-min", 15, 60),
  userImages: sharedLimiter("ai-user-img-h", 5, 3600),
  orgMinute: sharedLimiter("ai-org-min", 30, 60),
  orgHour: sharedLimiter("ai-org-h", 60, 3600),
});
