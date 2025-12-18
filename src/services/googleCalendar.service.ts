import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { account, calendarEvents, users } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { env } from "@/utils/env.util";

// Debug: Log when the service module is loaded
if (process.env.NODE_ENV === "development") {
  logger.info("GoogleCalendarService module loaded");
}

export interface GoogleCalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  attendees?: Array<{
    email: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  conferenceData?: {
    createRequest?: {
      requestId: string;
      conferenceSolutionKey: {
        type: string;
      };
    };
  };
  recurrence?: string[];
  htmlLink?: string;
  hangoutLink?: string;
}

export class GoogleCalendarService {
  private oauth2Client: OAuth2Client;
  private calendar: calendar_v3.Calendar;

  constructor() {
    // Debug environment variables (only in development)
    if (process.env.NODE_ENV === "development") {
      logger.info(
        "GoogleCalendarService constructor - Environment variables:",
        {
          GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ? "SET" : "NOT SET",
          GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ? "SET" : "NOT SET",
          GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI ? "SET" : "NOT SET",
          actualRedirectURI: env.GOOGLE_REDIRECT_URI,
        }
      );
    }

    this.oauth2Client = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );

    this.calendar = google.calendar({ version: "v3", auth: this.oauth2Client });
  }

  /**
   * Get user's timezone from database
   */
  private async getUserTimezone(userId: string): Promise<string> {
    try {
      const user = await database
        .select({ timezone: users.timezone })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      return user[0]?.timezone || "UTC";
    } catch (error) {
      logger.error("Error getting user timezone:", error);
      return "UTC";
    }
  }

  /**
   * Generate OAuth2 authorization URL
   */
  generateAuthUrl(userId: string): string {
    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      state: userId, // Pass user ID in state for callback
      prompt: "consent", // Force consent screen to get refresh token
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, userId: string): Promise<void> {
    try {
      logger.info("Exchanging code for tokens", {
        userId,
        code: code.substring(0, 10) + "...",
        redirectURI: env.GOOGLE_REDIRECT_URI,
      });

      const { tokens } = await this.oauth2Client.getToken(code);

      logger.info("Tokens received from Google", {
        userId,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        scope: tokens.scope,
      });

      // Store tokens in database
      logger.info("Storing tokens in database", {
        userId,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiryDate: tokens.expiry_date,
      });

      const accountData = {
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "google",
        userId: userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        accessTokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
        scope: tokens.scope,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      logger.info("Account data to insert:", accountData);

      await database
        .insert(account)
        .values(accountData)
        .onConflictDoUpdate({
          target: [account.userId, account.providerId],
          set: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            accessTokenExpiresAt: tokens.expiry_date
              ? new Date(tokens.expiry_date)
              : null,
            scope: tokens.scope,
            updatedAt: new Date(),
          },
        });

      logger.info("Google Calendar tokens stored successfully", { userId });
    } catch (error) {
      logger.error("Error exchanging code for tokens:", error);

      // Log detailed error information
      const errorDetails = {
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        userId,
        code: code.substring(0, 10) + "...",
        redirectURI: env.GOOGLE_REDIRECT_URI,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
        errorCode: (error as any)?.code,
        errorStatus: (error as any)?.status,
        errorResponse: (error as any)?.response?.data,
        fullError: JSON.stringify(error, null, 2),
      };

      logger.error("Error details:", errorDetails);
      console.error("Full error object:", error);

      throw new Error("Failed to exchange authorization code for tokens");
    }
  }

  /**
   * Get user's Google Calendar tokens
   */
  async getUserTokens(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
  } | null> {
    try {
      const userAccount = await database.query.account.findFirst({
        where: and(
          eq(account.userId, userId),
          eq(account.providerId, "google")
        ),
      });

      if (!userAccount?.accessToken || !userAccount?.refreshToken) {
        return null;
      }

      return {
        accessToken: userAccount.accessToken,
        refreshToken: userAccount.refreshToken,
      };
    } catch (error) {
      logger.error("Error getting user tokens:", error);
      return null;
    }
  }

  /**
   * Set credentials for API calls
   */
  async setCredentials(userId: string): Promise<boolean> {
    try {
      const tokens = await this.getUserTokens(userId);
      if (!tokens) {
        return false;
      }

      this.oauth2Client.setCredentials({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });

      return true;
    } catch (error) {
      logger.error("Error setting credentials:", error);
      return false;
    }
  }

  /**
   * Refresh access token if needed
   */
  async refreshAccessToken(userId: string): Promise<boolean> {
    try {
      const tokens = await this.getUserTokens(userId);
      if (!tokens?.refreshToken) {
        return false;
      }

      this.oauth2Client.setCredentials({
        refresh_token: tokens.refreshToken,
      });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      // Update tokens in database
      await database
        .update(account)
        .set({
          accessToken: credentials.access_token,
          accessTokenExpiresAt: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(account.userId, userId), eq(account.providerId, "google"))
        );

      // Set new credentials
      this.oauth2Client.setCredentials(credentials);

      return true;
    } catch (error) {
      logger.error("Error refreshing access token:", error);
      return false;
    }
  }

  /**
   * Get user's calendars
   */
  async getUserCalendars(
    userId: string
  ): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    try {
      const hasCredentials = await this.setCredentials(userId);
      if (!hasCredentials) {
        throw new Error("No Google Calendar credentials found");
      }

      const response = await this.calendar.calendarList.list();
      return response.data.items || [];
    } catch (error) {
      logger.error("Error getting user calendars:", error);
      throw error;
    }
  }

  /**
   * Create event in Google Calendar
   */
  async createEvent(
    userId: string,
    calendarId: string = "primary",
    event: GoogleCalendarEvent
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const hasCredentials = await this.setCredentials(userId);
      if (!hasCredentials) {
        throw new Error("No Google Calendar credentials found");
      }

      const response = await this.calendar.events.insert({
        calendarId,
        requestBody: event,
      });

      logger.info("Google Calendar event created successfully", {
        userId,
        eventId: response.data.id,
        calendarId,
      });

      return response.data;
    } catch (error) {
      logger.error("Error creating Google Calendar event:", error);
      throw error;
    }
  }

  /**
   * Update event in Google Calendar
   */
  async updateEvent(
    userId: string,
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEvent
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const hasCredentials = await this.setCredentials(userId);
      if (!hasCredentials) {
        throw new Error("No Google Calendar credentials found");
      }

      const response = await this.calendar.events.update({
        calendarId,
        eventId,
        requestBody: event,
      });

      logger.info("Google Calendar event updated successfully", {
        userId,
        eventId,
        calendarId,
      });

      return response.data;
    } catch (error) {
      logger.error("Error updating Google Calendar event:", error);
      throw error;
    }
  }

  /**
   * Delete event from Google Calendar
   */
  async deleteEvent(
    userId: string,
    calendarId: string,
    eventId: string
  ): Promise<void> {
    try {
      const hasCredentials = await this.setCredentials(userId);
      if (!hasCredentials) {
        throw new Error("No Google Calendar credentials found");
      }

      await this.calendar.events.delete({
        calendarId,
        eventId,
      });

      logger.info("Google Calendar event deleted successfully", {
        userId,
        eventId,
        calendarId,
      });
    } catch (error) {
      logger.error("Error deleting Google Calendar event:", error);
      throw error;
    }
  }

  /**
   * Get events from Google Calendar
   */
  async getEvents(
    userId: string,
    calendarId: string = "primary",
    timeMin?: string,
    timeMax?: string,
    maxResults: number = 100
  ): Promise<calendar_v3.Schema$Event[]> {
    try {
      const hasCredentials = await this.setCredentials(userId);
      if (!hasCredentials) {
        throw new Error("No Google Calendar credentials found");
      }

      const response = await this.calendar.events.list({
        calendarId,
        timeMin,
        timeMax,
        maxResults,
        singleEvents: true,
        orderBy: "startTime",
      });

      return response.data.items || [];
    } catch (error) {
      logger.error("Error getting Google Calendar events:", error);
      throw error;
    }
  }

  /**
   * Sync app event to Google Calendar
   */
  async syncAppEventToGoogle(
    userId: string,
    appEvent: any,
    calendarId: string = "primary"
  ): Promise<calendar_v3.Schema$Event | null> {
    try {
      // Get user's timezone from database
      const userTimezone = await this.getUserTimezone(userId);

      // appEvent.date is stored as midnight UTC representing the date
      // startHour and endHour are in the user's local timezone
      // We need to create a date string in the format YYYY-MM-DDTHH:mm:ss
      // that Google Calendar will interpret according to the timeZone field

      const eventDate = new Date(appEvent.date);
      // Get the date components (year, month, day) from the UTC date
      const year = eventDate.getUTCFullYear();
      const month = String(eventDate.getUTCMonth() + 1).padStart(2, "0");
      const day = String(eventDate.getUTCDate()).padStart(2, "0");

      // Format hours with leading zeros
      const startHourStr = String(appEvent.startHour).padStart(2, "0");
      const endHourStr = String(appEvent.endHour).padStart(2, "0");

      // Create date-time strings in the format Google Calendar expects
      // Format: YYYY-MM-DDTHH:mm:ss (without timezone, Google will interpret based on timeZone field)
      const startDateTimeStr = `${year}-${month}-${day}T${startHourStr}:00:00`;
      const endDateTimeStr = `${year}-${month}-${day}T${endHourStr}:00:00`;

      const googleEvent: GoogleCalendarEvent = {
        summary: appEvent.title,
        description: appEvent.description,
        start: {
          dateTime: startDateTimeStr,
          timeZone: userTimezone,
        },
        end: {
          dateTime: endDateTimeStr,
          timeZone: userTimezone,
        },
        location: appEvent.location,
      };

      // Add conference data if platform is Google Meet
      if (appEvent.platform === "google_meet") {
        googleEvent.conferenceData = {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: {
              type: "hangoutsMeet",
            },
          },
        };
      }

      const createdEvent = await this.createEvent(
        userId,
        calendarId,
        googleEvent
      );

      // Update app event with Google event ID
      await database
        .update(calendarEvents)
        .set({
          googleEventId: createdEvent.id,
          googleCalendarId: calendarId,
          syncStatus: "synced",
          lastSyncAt: new Date(),
          googleEventData: {
            htmlLink: createdEvent.htmlLink || "",
            hangoutLink: createdEvent.hangoutLink || "",
            conferenceData: createdEvent.conferenceData,
          },
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, appEvent.id));

      return createdEvent;
    } catch (error) {
      logger.error("Error syncing app event to Google:", error);

      // Update sync status to failed
      await database
        .update(calendarEvents)
        .set({
          syncStatus: "failed",
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(calendarEvents.id, appEvent.id));

      return null;
    }
  }

  /**
   * Sync Google event to app
   */
  async syncGoogleEventToApp(
    userId: string,
    googleEvent: calendar_v3.Schema$Event,
    organizationId: string
  ): Promise<any> {
    try {
      const startDateTime =
        googleEvent.start?.dateTime || googleEvent.start?.date;
      const endDateTime = googleEvent.end?.dateTime || googleEvent.end?.date;

      if (!startDateTime || !endDateTime) {
        throw new Error("Invalid event start or end time");
      }

      // Get user's timezone
      const userTimezone = await this.getUserTimezone(userId);

      // Parse the Google Calendar datetime (which includes timezone info)
      const startDate = new Date(startDateTime);
      const endDate = new Date(endDateTime);

      // Get the date components in user's timezone
      const startDateParts = startDate
        .toLocaleDateString("en-CA", {
          timeZone: userTimezone,
        })
        .split("-"); // Returns YYYY-MM-DD
      const startYear = parseInt(startDateParts[0]);
      const startMonth = parseInt(startDateParts[1]) - 1; // Month is 0-indexed
      const startDay = parseInt(startDateParts[2]);

      // Get hours in user's timezone
      const startHourStr = startDate.toLocaleTimeString("en-US", {
        timeZone: userTimezone,
        hour: "2-digit",
        hour12: false,
      });
      const startHour = parseInt(startHourStr.split(":")[0]);

      const endHourStr = endDate.toLocaleTimeString("en-US", {
        timeZone: userTimezone,
        hour: "2-digit",
        hour12: false,
      });
      const endHour = parseInt(endHourStr.split(":")[0]);

      // Create date at midnight UTC for the date in user's timezone
      // This represents the date (not time) in the user's timezone
      const eventDate = new Date(
        Date.UTC(startYear, startMonth, startDay, 0, 0, 0, 0)
      );

      const appEvent = {
        id: crypto.randomUUID(),
        title: googleEvent.summary || "Untitled Event",
        description: googleEvent.description || "",
        date: eventDate,
        startHour: startHour,
        endHour: endHour,
        calendarType: "work" as const,
        platform: "google_meet" as const,
        meetLink: googleEvent.hangoutLink || "",
        organizationId,
        userId,
        googleEventId: googleEvent.id || "",
        googleCalendarId: "primary",
        syncStatus: "synced" as const,
        lastSyncAt: new Date(),
        syncDirection: "google_to_app" as const,
        googleEventData: {
          htmlLink: googleEvent.htmlLink || undefined,
          hangoutLink: googleEvent.hangoutLink || undefined,
          conferenceData: googleEvent.conferenceData,
          attendees: googleEvent.attendees,
          location: googleEvent.location || undefined,
          recurrence: googleEvent.recurrence || undefined,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // 🔍 BACKEND DEBUG: Log Google to App sync details
      console.log("🔍 BACKEND Google to App Sync Debug:", {
        userId,
        organizationId,
        googleEvent: {
          id: googleEvent.id,
          summary: googleEvent.summary,
          startDateTime,
          endDateTime,
          startTimeZone: googleEvent.start?.timeZone,
          endTimeZone: googleEvent.end?.timeZone,
        },
        appEvent: {
          id: appEvent.id,
          title: appEvent.title,
          date: appEvent.date.toISOString(),
          dateLocal: appEvent.date.toLocaleDateString(),
          startHour: appEvent.startHour,
          endHour: appEvent.endHour,
        },
      });

      const [createdEvent] = await database
        .insert(calendarEvents)
        .values(appEvent)
        .returning();

      logger.info("Google Calendar event synced to app successfully", {
        userId,
        googleEventId: googleEvent.id,
        appEventId: createdEvent.id,
      });

      return createdEvent;
    } catch (error) {
      logger.error("Error syncing Google event to app:", error);
      throw error;
    }
  }
}

// Debug: Log when the service is instantiated (only in development)
if (process.env.NODE_ENV === "development") {
  logger.info("Instantiating GoogleCalendarService...");
}
export const googleCalendarService = new GoogleCalendarService();
if (process.env.NODE_ENV === "development") {
  logger.info("GoogleCalendarService instantiated successfully");
}
