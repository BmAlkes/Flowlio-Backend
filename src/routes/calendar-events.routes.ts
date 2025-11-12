import { Router } from "express";
import { createCalendarEvent } from "@/controllers/organization/calendar-events/createcalendarevent.controller";
import { getCalendarEvents } from "@/controllers/organization/calendar-events/getcalendarevents.controller";
import { updateCalendarEvent } from "@/controllers/organization/calendar-events/updatecalendarevent.controller";
import { deleteCalendarEvent } from "@/controllers/organization/calendar-events/deletecalendarevent.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

// ==================== CALENDAR EVENTS ROUTES ====================

// Create a new calendar event
router.post("/calendar-events", isAuthenticated, createCalendarEvent);

// Get calendar events (with optional filters)
router.get("/calendar-events", isAuthenticated, getCalendarEvents);

// Update a calendar event
router.put("/calendar-events/:id", isAuthenticated, updateCalendarEvent);

// Delete a calendar event
router.delete("/calendar-events/:id", isAuthenticated, deleteCalendarEvent);

export default router;
