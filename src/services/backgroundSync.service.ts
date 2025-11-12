import { googleCalendarService } from "./googleCalendar.service";
import { database } from "../configs/connection.config";
import { calendarEvents, account, userOrganizations } from "../schema/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../utils/logger.util";

const isProduction = process.env.NODE_ENV === "production";
const isRailway =
  process.env.RAILWAY_ENVIRONMENT === "production" ||
  !!process.env.RAILWAY_PROJECT_ID;

export class BackgroundSyncService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start periodic background sync
   * @param intervalMinutes - Sync interval in minutes (default: 15)
   */
  startPeriodicSync(intervalMinutes: number = 15): void {
    if (this.syncInterval) {
      if (!isProduction && !isRailway) {
        logger.warn("Background sync is already running");
      }
      return;
    }

    if (!isProduction && !isRailway) {
      logger.info(`Starting background sync every ${intervalMinutes} minutes`);
    }

    this.syncInterval = setInterval(async () => {
      if (!this.isRunning) {
        await this.performBackgroundSync();
      }
    }, intervalMinutes * 60 * 1000);

    // Don't run initial sync immediately - let the first interval trigger it
    // This prevents blocking server startup
    // The sync will run after the first interval (60 minutes by default)
  }

  /**
   * Stop periodic background sync
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info("Background sync stopped");
    }
  }

  /**
   * Perform background sync for all connected users
   */
  async performBackgroundSync(): Promise<void> {
    if (this.isRunning) {
      if (!isProduction && !isRailway) {
        logger.warn("Background sync is already running, skipping");
      }
      return;
    }

    this.isRunning = true;
    if (!isProduction && !isRailway) {
      logger.info("Starting background sync process");
    }

    try {
      // Get all users with Google Calendar credentials
      const connectedUsers = await database
        .select({
          userId: account.userId,
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
        })
        .from(account)
        .where(
          and(
            eq(account.providerId, "google"),
            eq(account.accessToken, account.accessToken) // Not null
          )
        );

      if (!isProduction && !isRailway) {
        logger.info(
          `Found ${connectedUsers.length} users with Google Calendar connected`
        );
      }

      const syncResults = {
        totalUsers: connectedUsers.length,
        successfulSyncs: 0,
        failedSyncs: 0,
        errors: [] as any[],
      };

      // Sync each user's events
      for (const user of connectedUsers) {
        try {
          await this.syncUserEvents(user.userId);
          syncResults.successfulSyncs++;
        } catch (error) {
          syncResults.failedSyncs++;
          syncResults.errors.push({
            userId: user.userId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          if (!isProduction && !isRailway) {
            logger.error(
              `Failed to sync events for user ${user.userId}:`,
              error
            );
          }
        }
      }

      if (!isProduction && !isRailway) {
        logger.info("Background sync completed", syncResults);
      }
    } catch (error) {
      logger.error("Error during background sync:", error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Sync events for a specific user
   */
  private async syncUserEvents(userId: string): Promise<void> {
    logger.info(`Syncing events for user: ${userId}`);

    // Set credentials for the user
    const hasCredentials = await googleCalendarService.setCredentials(userId);
    if (!hasCredentials) {
      logger.warn(`No valid credentials for user: ${userId}`);
      return;
    }

    // Get time range for sync (last 7 days to next 30 days)
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysFromNow = new Date(
      now.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    // Step 1: Sync Google Calendar events to app
    try {
      const googleEvents = await googleCalendarService.getEvents(
        userId,
        "primary",
        sevenDaysAgo.toISOString(),
        thirtyDaysFromNow.toISOString(),
        100
      );

      logger.info(
        `Found ${googleEvents.length} Google Calendar events for user ${userId}`
      );

      // Get all existing app events with Google Calendar IDs
      const existingAppEvents = await database
        .select()
        .from(calendarEvents)
        .where(
          and(
            eq(calendarEvents.userId, userId),
            isNotNull(calendarEvents.googleEventId)
          )
        );

      const googleEventIds = googleEvents
        .map((event) => event.id)
        .filter((id): id is string => Boolean(id));
      const appEventGoogleIds = existingAppEvents
        .map((event) => event.googleEventId)
        .filter((id): id is string => Boolean(id));

      // Find events that exist in app but not in Google Calendar (deleted from Google)
      const deletedFromGoogle = appEventGoogleIds.filter(
        (appGoogleId) => !googleEventIds.includes(appGoogleId)
      );

      // Delete events that were removed from Google Calendar
      for (const deletedGoogleId of deletedFromGoogle) {
        if (!deletedGoogleId) continue; // Skip if ID is empty

        try {
          const eventToDelete = existingAppEvents.find(
            (event) => event.googleEventId === deletedGoogleId
          );

          if (eventToDelete) {
            await database
              .delete(calendarEvents)
              .where(eq(calendarEvents.id, eventToDelete.id));

            logger.info(
              `Deleted app event that was removed from Google Calendar: ${eventToDelete.id}`
            );
          }
        } catch (error) {
          logger.error(`Failed to delete app event ${deletedGoogleId}:`, error);
        }
      }

      // Create new events from Google Calendar
      for (const googleEvent of googleEvents) {
        try {
          // Check if event already exists
          const existingEvent = await database.query.calendarEvents.findFirst({
            where: eq(calendarEvents.googleEventId, googleEvent.id || ""),
          });

          if (!existingEvent) {
            // Get user's organization
            const userOrg = await database
              .select({ organizationId: userOrganizations.organizationId })
              .from(userOrganizations)
              .where(eq(userOrganizations.userId, userId))
              .limit(1);

            if (userOrg.length > 0) {
              // Create new event in app
              const appEvent = await googleCalendarService.syncGoogleEventToApp(
                userId,
                googleEvent,
                userOrg[0].organizationId
              );

              logger.info(
                `Created new event from Google Calendar: ${appEvent.id}`
              );
            }
          }
        } catch (error) {
          logger.error(`Failed to sync Google event ${googleEvent.id}:`, error);
        }
      }
    } catch (error) {
      logger.error(
        `Failed to fetch Google Calendar events for user ${userId}:`,
        error
      );
    }

    // Step 2: Sync app events to Google Calendar
    try {
      const appEvents = await database
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, userId));

      logger.info(`Found ${appEvents.length} app events for user ${userId}`);

      // Get all Google Calendar events again for comparison
      const googleEvents = await googleCalendarService.getEvents(
        userId,
        "primary",
        sevenDaysAgo.toISOString(),
        thirtyDaysFromNow.toISOString(),
        100
      );

      const googleEventIds = googleEvents
        .map((event) => event.id)
        .filter((id): id is string => Boolean(id));
      const appEventGoogleIds = appEvents
        .map((event) => event.googleEventId)
        .filter((id): id is string => Boolean(id));

      // Find events that exist in Google Calendar but not in app (deleted from app)
      const deletedFromApp = googleEventIds.filter(
        (googleId) => !appEventGoogleIds.includes(googleId)
      );

      // Delete events from Google Calendar that were removed from app
      for (const deletedGoogleId of deletedFromApp) {
        if (!deletedGoogleId) continue; // Skip if ID is empty

        try {
          await googleCalendarService.deleteEvent(
            userId,
            "primary",
            deletedGoogleId
          );

          logger.info(
            `Deleted Google Calendar event that was removed from app: ${deletedGoogleId}`
          );
        } catch (error) {
          logger.error(
            `Failed to delete Google event ${deletedGoogleId}:`,
            error
          );
        }
      }

      // Sync new app events to Google Calendar
      for (const appEvent of appEvents) {
        try {
          if (!appEvent.googleEventId) {
            // Sync new app event to Google Calendar
            const googleEvent =
              await googleCalendarService.syncAppEventToGoogle(
                userId,
                appEvent,
                "primary"
              );

            if (googleEvent) {
              // Update local event with Google Calendar data
              await database
                .update(calendarEvents)
                .set({
                  googleEventId: googleEvent.id,
                  googleCalendarId: "primary",
                  syncStatus: "synced",
                  lastSyncAt: new Date(),
                  googleEventData: {
                    htmlLink: googleEvent.htmlLink || undefined,
                    hangoutLink: googleEvent.hangoutLink || undefined,
                    location: googleEvent.location || undefined,
                    recurrence: googleEvent.recurrence || undefined,
                  },
                })
                .where(eq(calendarEvents.id, appEvent.id));

              logger.info(
                `Synced app event to Google Calendar: ${appEvent.id}`
              );
            }
          }
        } catch (error) {
          logger.error(`Failed to sync app event ${appEvent.id}:`, error);
        }
      }
    } catch (error) {
      logger.error(`Failed to sync app events for user ${userId}:`, error);
    }

    logger.info(`Completed sync for user: ${userId}`);
  }

  /**
   * Force sync for a specific user (can be called manually)
   */
  async forceSyncUser(userId: string): Promise<void> {
    logger.info(`Force syncing events for user: ${userId}`);
    await this.syncUserEvents(userId);
  }

  /**
   * Get sync status
   */
  getSyncStatus(): { isRunning: boolean; hasInterval: boolean } {
    return {
      isRunning: this.isRunning,
      hasInterval: this.syncInterval !== null,
    };
  }
}

// Export singleton instance
export const backgroundSyncService = new BackgroundSyncService();
