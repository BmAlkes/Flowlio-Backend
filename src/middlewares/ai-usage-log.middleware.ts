import { Request, Response, NextFunction } from "express";
import { aiContext, AIContext } from "@/utils/ai-context.util";

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


// Establish identity only. Provider calls own the single durable usage record.
export const logAIUsage = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user?.id || !req.user.organizationId) {
    res.status(403).json({ success: false, error: "ORGANIZATION_REQUIRED" });
    return;
  }
  const context: AIContext = { userId: req.user.id, organizationId: req.user.organizationId,
    feature: resolveFeature(req.path), endpoint: req.originalUrl.split("?")[0] };
  const json = res.json.bind(res);
  // Legacy service/controller fallbacks must never disguise a quota/provider failure as success.
  res.json = (body) => {
    if (context.failure) {
      res.status(context.failure.status);
      return json({ success: false, error: context.failure.code, message: context.failure.message });
    }
    return json(body);
  };
  aiContext.run(context, next);
};
