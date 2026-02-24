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
  upload,
  getProjectInsights,
} from "../controllers/ai/aiAssistant.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { generateWeeklyProjectSummary } from "@/controllers/ai/generateweeklyprojectsummary.controller";

const router = Router();

router.post(
  "/suggestions",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventSuggestions
);

router.post(
  "/categories",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventCategories
);

router.post(
  "/enhance-description",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  enhanceEventDescription
);

router.get(
  "/insights",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  getCalendarInsights
);

router.post(
  "/conversation",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  upload.array("files", 5),
  advancedConversation
);

router.post(
  "/generate-image",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateImage
);

router.post(
  "/generate-task",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateTaskFromNaturalLanguage
);

router.get(
  "/weekly-summary",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateWeeklyProjectSummary
);

router.get(
  "/project-insights",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  getProjectInsights
);

router.get(
  "/test",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  testOpenAI
);

export default router;
