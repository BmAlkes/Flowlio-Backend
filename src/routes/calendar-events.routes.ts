import { Router } from "express";
import { createCalendarEvent } from "@/controllers/organization/calendar-events/createcalendarevent.controller";
import { getCalendarEvents } from "@/controllers/organization/calendar-events/getcalendarevents.controller";
import { updateCalendarEvent } from "@/controllers/organization/calendar-events/updatecalendarevent.controller";
import { deleteCalendarEvent } from "@/controllers/organization/calendar-events/deletecalendarevent.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

router.post("/calendar-events", isAuthenticated, createCalendarEvent);

router.get("/calendar-events", isAuthenticated, getCalendarEvents);

router.put("/calendar-events/:id", isAuthenticated, updateCalendarEvent);

router.delete("/calendar-events/:id", isAuthenticated, deleteCalendarEvent);

export default router;
