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

const router = Router();

/**
 * AI Assistant Routes for Calendar Management
 */

// Generate AI-powered event suggestions
router.post("/suggestions", isAuthenticated, generateEventSuggestions);

// Generate event categories and tags
router.post("/categories", generateEventCategories);

// Enhance event description with AI
router.post("/enhance-description", enhanceEventDescription);

// Get AI-powered calendar insights
router.get("/insights", isAuthenticated, getCalendarInsights);

// Advanced AI conversation with file analysis
router.post("/conversation", isAuthenticated, upload.array("files", 5), advancedConversation);

// Generate images using DALL-E
router.post("/generate-image", isAuthenticated, generateImage);

// Test OpenAI service connection
router.get("/test", isAuthenticated, testOpenAI);

export default router;
