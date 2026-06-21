import { Request, Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import { aiUsageLogs } from "@/schema/schema";
import { logger } from "@/utils/logger.util";

const FEATURE_MAP: Record<string, string> = {
  "/suggestions": "event_suggestion",
  "/categories": "event_categories",
  "/enhance-description": "description_enhance",
  "/insights": "calendar_insights",
  "/conversation": "conversation",
  "/generate-image": "image_generation",
  "/generate-task": "task_generation",
  "/generate-proposal": "proposal_generation",
  "/weekly-summary": "weekly_summary",
  "/project-insights": "project_insights",
  "/test": "test",
};

function resolveFeature(path: string): string {
  for (const [suffix, feature] of Object.entries(FEATURE_MAP)) {
    if (path.endsWith(suffix)) return feature;
  }
  return "unknown";
}

/**
 * Fire-and-forget AI usage logger.
 * Skips if controller/gateway already logged (res.locals._aiLogged === true).
 */
export const logAIUsage = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  const originalJson = res.json.bind(res);
  let capturedBody: any = null;

  res.json = (body: any) => {
    capturedBody = body;
    return originalJson(body);
  };

  res.on("finish", () => {
    if ((res.locals as any)._aiLogged) return;

    const user = req.user as any;
    const orgId = user?.organizationId;
    const userId = user?.id;
    if (!orgId || !userId) return;

    const durationMs = Date.now() - startTime;
    const endpoint = req.originalUrl || req.path;
    const feature = resolveFeature(req.path);
    const isSuccess = res.statusCode >= 200 && res.statusCode < 400;

    const tokens = capturedBody?.data?.metadata?.tokens ?? 0;

    database
      .insert(aiUsageLogs)
      .values({
        organizationId: orgId,
        userId,
        feature,
        provider: "openai",
        model: capturedBody?.data?.metadata?.model ?? null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: typeof tokens === "number" ? tokens : 0,
        status: isSuccess ? "success" : "error",
        errorMessage: isSuccess ? null : (capturedBody?.message ?? null),
        endpoint,
        durationMs,
      })
      .catch((err) => logger.error("logAIUsage insert failed:", err));
  });

  next();
};
