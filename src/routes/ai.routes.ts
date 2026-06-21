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
import { checkAIAccess } from "@/middlewares/ai-rbac.middleware";
import { checkAITokenLimit } from "@/middlewares/ai-limit.middleware";
import { logAIUsage } from "@/middlewares/ai-usage-log.middleware";
import { aiRateLimit } from "@/middlewares/ai-rate-limit.middleware";
import { generateWeeklyProjectSummary } from "@/controllers/ai/generateweeklyprojectsummary.controller";

const router = Router();

// Rate limit + log every AI call
router.use(aiRateLimit);
router.use(logAIUsage);

router.post(
  "/suggestions",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateEventSuggestions
);

router.post(
  "/categories",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateEventCategories
);

router.post(
  "/enhance-description",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  enhanceEventDescription
);

router.get(
  "/insights",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  getCalendarInsights
);

router.post(
  "/conversation",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  upload.array("files", 5),
  advancedConversation
);

router.post(
  "/generate-image",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateImage
);

router.post(
  "/generate-task",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateTaskFromNaturalLanguage
);

router.get(
  "/weekly-summary",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateWeeklyProjectSummary
);

router.get(
  "/project-insights",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  getProjectInsights
);

router.get(
  "/test",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  testOpenAI
);

router.post(
  "/generate-proposal",
  isAuthenticated,
  checkAIAccess,
  checkAITokenLimit,
  requirePlanFeature("aiAssist"),
  generateProposal
);

export default router;
