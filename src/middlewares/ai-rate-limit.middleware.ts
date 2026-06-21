import { Request, Response, NextFunction } from "express";
import { RateLimiterMemory } from "rate-limiter-flexible";

// Per-user: 15 requests per minute for all AI, 5 image generations per hour
const perUserMinute = new RateLimiterMemory({ keyPrefix: "ai-user-min", points: 15, duration: 60 });
const perUserImageHour = new RateLimiterMemory({ keyPrefix: "ai-user-img-h", points: 5, duration: 3600 });

// Per-org: 30 requests per minute, 60 per hour
const perOrgMinute = new RateLimiterMemory({ keyPrefix: "ai-org-min", points: 30, duration: 60 });
const perOrgHour = new RateLimiterMemory({ keyPrefix: "ai-org-h", points: 60, duration: 3600 });

function rateLimitedResponse(res: Response, retryAfter: number): void {
  res.set("Retry-After", String(Math.ceil(retryAfter)));
  res.status(429).json({
    success: false,
    error: "RATE_LIMITED",
    message: "Too many AI requests. Please wait a moment.",
    retryAfter: Math.ceil(retryAfter),
  });
}

/**
 * AI-specific rate limiter. Superadmins bypass all limits.
 * Applies per-user and per-org limits; image generation has stricter per-user limits.
 */
export const aiRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const user = req.user as any;
  if (!user) { next(); return; }
  if (user.role === "superadmin" || user.isSuperAdmin === true) { next(); return; }

  const orgId = user.organizationId;
  const userId = user.id;
  if (!orgId || !userId) { next(); return; }

  const isImageRoute = req.path.includes("generate-image");

  try {
    // Per-user per-minute
    const userRes = await perUserMinute.consume(userId);
    if (userRes.remainingPoints <= 0) {
      rateLimitedResponse(res, userRes.msBeforeNext / 1000);
      return;
    }

    // Per-org per-minute
    const orgMinRes = await perOrgMinute.consume(orgId);
    if (orgMinRes.remainingPoints <= 0) {
      rateLimitedResponse(res, orgMinRes.msBeforeNext / 1000);
      return;
    }

    // Per-org per-hour
    const orgHourRes = await perOrgHour.consume(orgId);
    if (orgHourRes.remainingPoints <= 0) {
      rateLimitedResponse(res, orgHourRes.msBeforeNext / 1000);
      return;
    }

    // Image-specific: stricter per-user hourly limit
    if (isImageRoute) {
      const imgRes = await perUserImageHour.consume(userId);
      if (imgRes.remainingPoints <= 0) {
        rateLimitedResponse(res, imgRes.msBeforeNext / 1000);
        return;
      }
    }

    next();
  } catch (rejRes: any) {
    const retryAfter = rejRes.msBeforeNext ? rejRes.msBeforeNext / 1000 : 60;
    rateLimitedResponse(res, retryAfter);
  }
};
