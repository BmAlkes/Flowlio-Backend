import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { getViewerProjects } from "../controllers/viewer/projects/getviewerprojects.controller";
import { getViewerProjectById } from "../controllers/viewer/projects/getviewerprojectbyid.controller";
import { getViewerTasks } from "../controllers/viewer/tasks/getviewertasks.controller";
import { getActiveTimeEntries } from "../controllers/viewer/tasks/getactivetimeentries.controller";
import { getAllTimeEntries } from "../controllers/viewer/tasks/getalltimeentries.controller";
import { startTask } from "../controllers/viewer/tasks/starttask.controller";
import { endTask } from "../controllers/viewer/tasks/endtask.controller";
import { deleteTimeEntry } from "../controllers/viewer/tasks/deletetimeentry.controller";

// Import AI and Calendar controllers
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
import { createCalendarEvent } from "../controllers/organization/calendar-events/createcalendarevent.controller";
import { getCalendarEvents } from "../controllers/organization/calendar-events/getcalendarevents.controller";
import { updateCalendarEvent } from "../controllers/organization/calendar-events/updatecalendarevent.controller";
import { deleteCalendarEvent } from "../controllers/organization/calendar-events/deletecalendarevent.controller";
import {
  createViewerSupportTicket,
  getViewerSupportTickets,
} from "../controllers/support ticket/create-viewer-supportticket.controller";
import { getSupportTicketMessages } from "../controllers/support ticket/get-ticketmessages.controller";
import { createTicketMessage } from "../controllers/support ticket/create-ticketmessage.controller";
import { updateViewerSupportTicket } from "../controllers/support ticket/update-viewer-ticket.controller";

const router = Router();

// ==================== VIEWER PROJECTS ROUTES ====================
router.get("/projects", isAuthenticated, getViewerProjects);
router.get("/projects/:id", isAuthenticated, getViewerProjectById);

// ==================== VIEWER TASKS ROUTES ====================
router.get("/tasks", isAuthenticated, getViewerTasks);
router.get("/tasks/active-time", isAuthenticated, getActiveTimeEntries);
router.get("/tasks/time-entries", isAuthenticated, getAllTimeEntries);
router.delete("/tasks/time-entries/:id", isAuthenticated, deleteTimeEntry);
router.post("/tasks/:id/start", isAuthenticated, startTask);
router.post("/tasks/:id/end", isAuthenticated, endTask);

// ==================== VIEWER AI ASSISTANT ROUTES ====================
// Generate AI-powered event suggestions
router.post(
  "/ai/suggestions",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventSuggestions,
);

// Generate event categories and tags
router.post(
  "/ai/categories",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateEventCategories,
);

// Enhance event description with AI
router.post(
  "/ai/enhance-description",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  enhanceEventDescription,
);

// Get AI-powered calendar insights
router.get(
  "/ai/insights",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  getCalendarInsights,
);

// Advanced AI conversation with file analysis
router.post(
  "/ai/conversation",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  upload.array("files", 5),
  advancedConversation,
);

// Generate images using DALL-E
router.post(
  "/ai/generate-image",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  generateImage,
);

// Test OpenAI service connection
router.get(
  "/ai/test",
  isAuthenticated,
  requirePlanFeature("aiAssist"),
  testOpenAI,
);

// ==================== VIEWER CALENDAR ROUTES ====================
// Create a new calendar event
router.post("/calendar-events", isAuthenticated, createCalendarEvent);

// Get calendar events (with optional filters)
router.get("/calendar-events", isAuthenticated, getCalendarEvents);

// Update a calendar event
router.put("/calendar-events/:id", isAuthenticated, updateCalendarEvent);

// Delete a calendar event
router.delete("/calendar-events/:id", isAuthenticated, deleteCalendarEvent);

// ==================== VIEWER SUPPORT TICKETS ROUTES ====================
router.post("/support-tickets", isAuthenticated, createViewerSupportTicket);
router.get("/support-tickets", isAuthenticated, getViewerSupportTickets);
router.get("/support-tickets/:id/messages", isAuthenticated, getSupportTicketMessages);
router.post("/support-tickets/:id/messages", isAuthenticated, createTicketMessage);
router.put("/support-tickets/:id", isAuthenticated, updateViewerSupportTicket);

export default router;
