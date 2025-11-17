import { Router } from "express";
import {
  generateEventSuggestions,
  generateEventCategories,
  getCalendarInsights,
  enhanceEventDescription,
  advancedConversation,
  generateImage,
  testOpenAI,
  upload,
} from "../controllers/ai/aiAssistant.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";

const router = Router();

/**
 * AI Assistant Routes for Calendar Management
 */

// Generate AI-powered event suggestions
router.post(
  "/suggestions",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventSuggestions
);

// Generate event categories and tags
router.post(
  "/categories",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventCategories
);

// Enhance event description with AI
router.post(
  "/enhance-description",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  enhanceEventDescription
);

// Get AI-powered calendar insights
router.get(
  "/insights",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  getCalendarInsights
);

// Advanced AI conversation with file analysis
router.post(
  "/conversation",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  upload.array("files", 5),
  advancedConversation
);

// Generate images using DALL-E
router.post(
  "/generate-image",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateImage
);

// Test OpenAI service connection
router.get(
  "/test",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  testOpenAI
);

export default router;
