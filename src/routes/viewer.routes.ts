import { validateListQuery } from "../utils/list-query";
import { resourceAccess } from "../security/resource-access";
import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { logAIUsage } from "@/middlewares/ai-usage-log.middleware";
import { requireAIOrganization } from "@/middlewares/ai-rbac.middleware";
import { checkAITokenLimit } from "@/middlewares/ai-limit.middleware";
import { aiRateLimit } from "@/middlewares/ai-rate-limit.middleware";
import { requireViewer } from "@/middlewares/role.middleware";
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

router.use(isAuthenticated, requireViewer);

// ==================== VIEWER PROJECTS ROUTES ====================
router.get("/projects", isAuthenticated, getViewerProjects);
router.get("/projects/:id", isAuthenticated, getViewerProjectById);

// ==================== VIEWER TASKS ROUTES ====================
router.get("/tasks", isAuthenticated, getViewerTasks);
router.get("/tasks/active-time", isAuthenticated, getActiveTimeEntries);
router.get("/tasks/time-entries", isAuthenticated, validateListQuery, getAllTimeEntries);
router.delete("/tasks/time-entries/:id", isAuthenticated, deleteTimeEntry);
router.post("/tasks/:id/start", isAuthenticated, resourceAccess.task(req => req.params.id, "track"), startTask);
router.post("/tasks/:id/end", isAuthenticated, resourceAccess.task(req => req.params.id, "track"), endTask);

// ==================== VIEWER AI ASSISTANT ROUTES ====================
const aiMiddleware = [requireAIOrganization, requirePlanFeature("aiAssist"), aiRateLimit, checkAITokenLimit, logAIUsage];

router.post("/ai/suggestions", ...aiMiddleware, generateEventSuggestions);
router.post("/ai/categories", ...aiMiddleware, generateEventCategories);
router.post("/ai/enhance-description", ...aiMiddleware, enhanceEventDescription);
router.get("/ai/insights", ...aiMiddleware, getCalendarInsights);
router.post("/ai/conversation", ...aiMiddleware, upload.array("files", 5), advancedConversation);
router.post("/ai/generate-image", ...aiMiddleware, generateImage);
router.get("/ai/test", ...aiMiddleware, testOpenAI);

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
