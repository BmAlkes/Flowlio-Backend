import { Request, Response } from "express";
import { googleCalendarService } from "../../../services/googleCalendar.service";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { calendarEvents } from "@/schema/schema";
import { eq } from "drizzle-orm";
import status from "http-status";

/**
 * Sync app events to Google Calendar
 */
export const syncAppEventsToGoogle = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    const { eventIds, calendarId = "primary" } = req.body;

    if (!eventIds || !Array.isArray(eventIds)) {
      res.status(400).json({
        success: false,
        message: "Event IDs array is required",
      });
      return;
    }

    const results = [];
    const errors = [];

    for (const eventId of eventIds) {
      try {
        // Get the app event from database
        const appEvent = await database.query.calendarEvents.findFirst({
          where: eq(calendarEvents.id, eventId),
        });

        if (!appEvent) {
          errors.push({ eventId, error: "Event not found" });
          continue;
        }

        // Sync to Google Calendar
        const googleEvent = await googleCalendarService.syncAppEventToGoogle(
          req.user.id,
          appEvent,
          calendarId
        );

        if (googleEvent) {
          results.push({
            eventId,
            googleEventId: googleEvent.id,
            status: "synced",
          });
        } else {
          errors.push({ eventId, error: "Failed to sync to Google Calendar" });
        }
      } catch (error) {
        errors.push({
          eventId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    logger.info("App events synced to Google Calendar", {
      userId: req.user.id,
      syncedCount: results.length,
      errorCount: errors.length,
    });

    res.status(200).json({
      success: true,
      message: "Sync operation completed",
      data: {
        synced: results,
        errors,
        summary: {
          total: eventIds.length,
          synced: results.length,
          failed: errors.length,
        },
      },
    });
  } catch (error) {
    logger.error("Error syncing app events to Google Calendar:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to sync events to Google Calendar",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Sync Google Calendar events to app
 */
export const syncGoogleEventsToApp = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    const {
      calendarId = "primary",
      timeMin,
      timeMax,
      maxResults = 50,
    } = req.body;

    // Get events from Google Calendar
    const googleEvents = await googleCalendarService.getEvents(
      req.user.id,
      calendarId,
      timeMin,
      timeMax,
      maxResults
    );

    const results = [];
    const errors = [];

    for (const googleEvent of googleEvents) {
      try {
        // Check if event already exists in app
        const existingEvent = await database.query.calendarEvents.findFirst({
          where: eq(calendarEvents.googleEventId, googleEvent.id || ""),
        });

        if (existingEvent) {
          results.push({
            googleEventId: googleEvent.id,
            appEventId: existingEvent.id,
            status: "already_exists",
          });
          continue;
        }

        // Sync to app
        const appEvent = await googleCalendarService.syncGoogleEventToApp(
          req.user.id,
          googleEvent,
          req.user.organizationId
        );

        results.push({
          googleEventId: googleEvent.id,
          appEventId: appEvent.id,
          status: "synced",
        });
      } catch (error) {
        errors.push({
          googleEventId: googleEvent.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // logger.info("Google Calendar events synced to app", {
    //   userId: req.user.id,
    //   syncedCount: results.length,
    //   errorCount: errors.length,
    // });

    res.status(200).json({
      success: true,
      message: "Sync operation completed",
      data: {
        synced: results,
        errors,
        summary: {
          total: googleEvents.length,
          synced: results.length,
          failed: errors.length,
        },
      },
    });
  } catch (error) {
    logger.error("Error syncing Google Calendar events to app:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to sync Google Calendar events to app",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get user's Google Calendars
 */
export const getUserGoogleCalendars = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const calendars = await googleCalendarService.getUserCalendars(req.user.id);

    // logger.info("User Google Calendars fetched", {
    //   userId: req.user.id,
    //   calendarCount: calendars.length,
    // });

    res.status(200).json({
      success: true,
      message: "Google Calendars fetched successfully",
      data: calendars,
    });
  } catch (error) {
    logger.error("Error fetching user Google Calendars:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch Google Calendars",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Full bidirectional sync
 */
export const fullBidirectionalSync = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    const { calendarId = "primary" } = req.body;

    // Step 1: Sync Google events to app
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    const googleEvents = await googleCalendarService.getEvents(
      req.user.id,
      calendarId,
      thirtyDaysAgo.toISOString(),
      thirtyDaysFromNow.toISOString(),
      100
    );

    const googleToAppResults = [];
    const googleToAppErrors = [];

    for (const googleEvent of googleEvents) {
      try {
        const existingEvent = await database.query.calendarEvents.findFirst({
          where: eq(calendarEvents.googleEventId, googleEvent.id || ""),
        });

        if (existingEvent) {
          googleToAppResults.push({
            googleEventId: googleEvent.id,
            appEventId: existingEvent.id,
            status: "already_exists",
          });
          continue;
        }

        const appEvent = await googleCalendarService.syncGoogleEventToApp(
          req.user.id,
          googleEvent,
          req.user.organizationId
        );

        googleToAppResults.push({
          googleEventId: googleEvent.id,
          appEventId: appEvent.id,
          status: "synced",
        });
      } catch (error) {
        googleToAppErrors.push({
          googleEventId: googleEvent.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Step 2: Get app events and sync to Google
    const appEvents = await database.query.calendarEvents.findMany({
      where: eq(calendarEvents.userId, req.user.id),
    });

    const appToGoogleResults = [];
    const appToGoogleErrors = [];

    for (const appEvent of appEvents) {
      try {
        if (appEvent.googleEventId) {
          appToGoogleResults.push({
            eventId: appEvent.id,
            googleEventId: appEvent.googleEventId,
            status: "already_synced",
          });
          continue;
        }

        const googleEvent = await googleCalendarService.syncAppEventToGoogle(
          req.user.id,
          appEvent,
          calendarId
        );

        if (googleEvent) {
          appToGoogleResults.push({
            eventId: appEvent.id,
            googleEventId: googleEvent.id,
            status: "synced",
          });
        } else {
          appToGoogleErrors.push({
            eventId: appEvent.id,
            error: "Failed to sync to Google Calendar",
          });
        }
      } catch (error) {
        appToGoogleErrors.push({
          eventId: appEvent.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // logger.info("Full bidirectional sync completed", {
    //   userId: req.user.id,
    //   calendarId,
    // });

    res.status(200).json({
      success: true,
      message: "Full bidirectional sync completed",
      data: {
        googleToApp: {
          synced: googleToAppResults,
          errors: googleToAppErrors,
          summary: {
            total: googleEvents.length,
            synced: googleToAppResults.length,
            failed: googleToAppErrors.length,
          },
        },
        appToGoogle: {
          synced: appToGoogleResults,
          errors: appToGoogleErrors,
          summary: {
            total: appEvents.length,
            synced: appToGoogleResults.length,
            failed: appToGoogleErrors.length,
          },
        },
      },
    });
  } catch (error) {
    logger.error("Error performing full bidirectional sync:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to perform full bidirectional sync",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
