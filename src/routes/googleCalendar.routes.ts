import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import {
  generateGoogleAuthUrl,
  handleGoogleAuthCallback,
  checkGoogleCalendarStatus,
  disconnectGoogleCalendar,
} from "../controllers/organization/calendar-events/googleCalendarAuth.controller";
import {
  syncAppEventsToGoogle,
  syncGoogleEventsToApp,
  getUserGoogleCalendars,
  fullBidirectionalSync,
} from "../controllers/organization/calendar-events/googleCalendarSync.controller";
import {
  forceSyncUser,
  getSyncStatus,
  startBackgroundSync,
  stopBackgroundSync,
} from "../controllers/organization/calendar-events/backgroundSync.controller";

const router = Router();

// Google Calendar OAuth routes
router.get("/auth/url", isAuthenticated, generateGoogleAuthUrl);
router.get("/auth/callback", handleGoogleAuthCallback);
router.get("/auth/status", isAuthenticated, checkGoogleCalendarStatus);
router.delete("/auth/disconnect", isAuthenticated, disconnectGoogleCalendar);

// Google Calendar sync routes
router.post("/sync/app-to-google", isAuthenticated, syncAppEventsToGoogle);
router.post("/sync/google-to-app", isAuthenticated, syncGoogleEventsToApp);
router.post("/sync/bidirectional", isAuthenticated, fullBidirectionalSync);
router.get("/calendars", isAuthenticated, getUserGoogleCalendars);

// Background sync routes
router.post("/sync/force", isAuthenticated, forceSyncUser);
router.get("/sync/status", isAuthenticated, getSyncStatus);
router.post("/sync/start", isAuthenticated, startBackgroundSync);
router.post("/sync/stop", isAuthenticated, stopBackgroundSync);

export default router;
