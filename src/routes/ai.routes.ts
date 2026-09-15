import { Router } from "express";
import {
  generateEventSuggestions,
  generateEventCategories,
  getCalendarInsights,
  enhanceEventDescription,
  advancedConversation,
  generateImage,
  testOpenAI,
  generateTaskFromNaturalLanguage,
  generateProposal,
  upload,
  getProjectInsights,
} from "../controllers/ai/aiAssistant.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { checkAIAccess, requireAIOrganization } from "@/middlewares/ai-rbac.middleware";
import { checkAITokenLimit } from "@/middlewares/ai-limit.middleware";
import { logAIUsage } from "@/middlewares/ai-usage-log.middleware";
import { aiRateLimit } from "@/middlewares/ai-rate-limit.middleware";
import { generateWeeklyProjectSummary } from "@/controllers/ai/generateweeklyprojectsummary.controller";

const router = Router();

const aiMiddleware = [isAuthenticated, checkAIAccess, requireAIOrganization, requirePlanFeature("aiAssist"), aiRateLimit, checkAITokenLimit, logAIUsage];

router.post(
  "/suggestions",
  ...aiMiddleware,
  generateEventSuggestions
);

router.post(
  "/categories",
  ...aiMiddleware,
  generateEventCategories
);

router.post(
  "/enhance-description",
  ...aiMiddleware,
  enhanceEventDescription
);

router.get(
  "/insights",
  ...aiMiddleware,
  getCalendarInsights
);

router.post(
  "/conversation",
  ...aiMiddleware,
  upload.array("files", 5),
  advancedConversation
);

router.post(
  "/generate-image",
  ...aiMiddleware,
  generateImage
);

router.post(
  "/generate-task",
  ...aiMiddleware,
  generateTaskFromNaturalLanguage
);

router.get(
  "/weekly-summary",
  ...aiMiddleware,
  generateWeeklyProjectSummary
);

router.get(
  "/project-insights",
  ...aiMiddleware,
  getProjectInsights
);

router.get(
  "/test",
  ...aiMiddleware,
  testOpenAI
);

router.post(
  "/generate-proposal",
  ...aiMiddleware,
  generateProposal
);

export default router;
