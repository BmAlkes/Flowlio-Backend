import { google, calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { account, calendarEvents, users } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { env } from "@/utils/env.util";

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
  status?: string;
}

const STATE_TTL_MS = 10 * 60 * 1000;
const sign = (value: string) =>
  crypto.createHmac("sha256", env.BETTER_AUTH_SECRET).update("google-calendar:" + value).digest("base64url");

/** Calendar day (YYYY-MM-DD) of an instant in a time zone. */
export const dayIn = (date: Date, timeZone: string) => date.toLocaleDateString("en-CA", { timeZone });

function zoneOffsetMs(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - instant;
}

/** Midnight of a calendar day in a time zone, which is how the Calendar page shows a day. */
export function zonedMidnight(day: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** Day and whole hours of a Google event as seen in the user's time zone. */
export function fromGoogleTimes(event: calendar_v3.Schema$Event, timeZone: string) {
  if (event.start?.date) return { day: event.start.date, startHour: 0, endHour: 0, allDay: true };
  if (!event.start?.dateTime || !event.end?.dateTime) return null;
  const hour = (value: string) =>
    Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(value)));
  const start = new Date(event.start.dateTime);
  const crossesMidnight = dayIn(new Date(event.end.dateTime), timeZone) !== dayIn(start, timeZone);
  return { day: dayIn(start, timeZone), startHour: hour(event.start.dateTime), endHour: crossesMidnight ? 23 : hour(event.end.dateTime), allDay: false };
}

/** Flowlio event ids double as Google event ids, so a retried insert cannot create a duplicate. */
export const googleIdFor = (appEventId: string) => {
  const id = appEventId.replace(/-/g, "").toLowerCase();
  return /^[a-v0-9]{5,1024}$/.test(id) ? id : undefined;
};
export const appIdFromGoogle = (googleEventId: string) =>
  /^[0-9a-f]{32}$/.test(googleEventId)
    ? googleEventId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
    : null;

export class GoogleCalendarService {
  // Only used for the consent URL and the code exchange; API calls get a client per user.
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = this.newClient();
  }

  private newClient() {
    return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  }

  /**
   * A Calendar API client holding only this user's credentials. A shared client would let
   * concurrent requests for different users swap tokens mid-call.
   */
  private async calendarFor(userId: string): Promise<calendar_v3.Calendar> {
    const tokens = await this.getUserTokens(userId);
    if (!tokens) throw new Error("No Google Calendar credentials found");
    const auth = this.newClient();
    auth.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt?.getTime(),
    });
    auth.on("tokens", (fresh) => {
      if (!fresh.access_token) return;
      database
        .update(account)
        .set({
          accessToken: fresh.access_token,
          accessTokenExpiresAt: fresh.expiry_date ? new Date(fresh.expiry_date) : null,
          ...(fresh.refresh_token ? { refreshToken: fresh.refresh_token } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
        .catch((error) => logger.error("Failed to store refreshed Google token", { userId, errorMessage: error instanceof Error ? error.message : "Unknown error" }));
    });
    return google.calendar({ version: "v3", auth });
  }

  async getUserTimezone(userId: string): Promise<string> {
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
   * Generate OAuth2 authorization URL. The state is signed and expires, so a callback
   * cannot attach a Google account to somebody else's Flowlio user.
   */
  generateAuthUrl(userId: string): string {
    const scopes = [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ];
    const payload = `${userId}.${Date.now() + STATE_TTL_MS}`;

    return this.oauth2Client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      state: `${payload}.${sign(payload)}`,
      prompt: "consent", // Force consent screen to get refresh token
    });
  }

  /** Returns the user id carried by a valid, unexpired state, otherwise null. */
  verifyAuthState(state: string): string | null {
    const signatureAt = state.lastIndexOf(".");
    const expiryAt = state.lastIndexOf(".", signatureAt - 1);
    if (signatureAt < 0 || expiryAt <= 0) return null;
    const payload = state.slice(0, signatureAt);
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(state.slice(signatureAt + 1));
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (!(Number(state.slice(expiryAt + 1, signatureAt)) > Date.now())) return null;
    return state.slice(0, expiryAt);
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, userId: string): Promise<void> {
    try {
      const { tokens } = await this.oauth2Client.getToken(code);

      logger.info("Tokens received from Google", {
        userId,
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        scope: tokens.scope,
      });

      await database
        .insert(account)
        .values({
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
        })
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
      logger.error("Error exchanging code for tokens:", {
        message: error instanceof Error ? error.message : "Unknown error",
        userId,
        redirectURI: env.GOOGLE_REDIRECT_URI,
        errorCode: (error as any)?.code,
        errorStatus: (error as any)?.status,
        errorResponse: (error as any)?.response?.data,
      });

      throw new Error("Failed to exchange authorization code for tokens");
    }
  }

  /**
   * Get user's Google Calendar tokens
   */
  async getUserTokens(userId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date | null;
  } | null> {
    try {
      const userAccount = await database.query.account.findFirst({
        where: and(
          eq(account.userId, userId),
          eq(account.providerId, "google"),
        ),
      });

      if (!userAccount?.accessToken || !userAccount?.refreshToken) {
        return null;
      }

      return {
        accessToken: userAccount.accessToken,
        refreshToken: userAccount.refreshToken,
        expiresAt: userAccount.accessTokenExpiresAt ?? null,
      };
    } catch (error) {
      logger.error("Error getting user tokens:", error);
      return null;
    }
  }

  /**
   * Whether the user has Google Calendar connected. Credentials are no longer stored on
   * a shared client; each call below builds its own.
   */
  async setCredentials(userId: string): Promise<boolean> {
    return !!(await this.getUserTokens(userId));
  }

  /**
   * Get user's calendars
   */
  async getUserCalendars(
    userId: string,
  ): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    try {
      const calendar = await this.calendarFor(userId);
      const response = await calendar.calendarList.list();
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
    event: GoogleCalendarEvent,
  ): Promise<calendar_v3.Schema$Event> {
    const calendar = await this.calendarFor(userId);
    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
        conferenceDataVersion: event.conferenceData ? 1 : undefined,
      });

      logger.info("Google Calendar event created successfully", {
        userId,
        eventId: response.data.id,
        calendarId,
      });

      return response.data;
    } catch (error) {
      // The id already exists: an earlier attempt went through, or the event was deleted in Google.
      if ((error as any)?.code === 409 && event.id) {
        const existing = (await calendar.events.get({ calendarId, eventId: event.id })).data;
        if (existing.status !== "cancelled") return existing;
        return (await calendar.events.update({ calendarId, eventId: event.id, requestBody: { ...event, status: "confirmed" } })).data;
      }
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
    event: GoogleCalendarEvent,
  ): Promise<calendar_v3.Schema$Event> {
    try {
      const calendar = await this.calendarFor(userId);
      const response = await calendar.events.patch({
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
    eventId: string,
  ): Promise<void> {
    try {
      const calendar = await this.calendarFor(userId);
      await calendar.events.delete({
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
    maxResults: number = 100,
  ): Promise<calendar_v3.Schema$Event[]> {
    try {
      const calendar = await this.calendarFor(userId);
      const response = await calendar.events.list({
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
   * Changes in the primary calendar since a sync token, or every event in a window when
   * starting over. Deleted events come back with status "cancelled". An expired token
   * fails with code 410; the caller starts over.
   */
  async listChanges(
    userId: string,
    from: { syncToken: string } | { timeMin: string; timeMax: string },
  ): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null }> {
    const calendar = await this.calendarFor(userId);
    const items: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 40; page++) {
      const response = await calendar.events.list({
        calendarId: "primary",
        singleEvents: true,
        maxResults: 250,
        pageToken,
        ...("syncToken" in from ? { syncToken: from.syncToken, showDeleted: true } : { timeMin: from.timeMin, timeMax: from.timeMax }),
      });
      items.push(...(response.data.items || []));
      if (!response.data.nextPageToken) return { items, nextSyncToken: response.data.nextSyncToken || null };
      pageToken = response.data.nextPageToken;
    }
    throw new Error("Too many Google Calendar changes in one sync");
  }

  /** Ask Google to POST to `address` whenever the user's primary calendar changes. */
  async watchEvents(
    userId: string,
    channel: { id: string; token: string; address: string },
  ): Promise<{ resourceId: string; expiration: Date }> {
    const calendar = await this.calendarFor(userId);
    const response = await calendar.events.watch({
      calendarId: "primary",
      requestBody: { id: channel.id, token: channel.token, type: "web_hook", address: channel.address },
    });
    if (!response.data.resourceId) throw new Error("Google did not return a channel resource");
    return {
      resourceId: response.data.resourceId,
      expiration: new Date(Number(response.data.expiration) || Date.now() + 7 * 86400000),
    };
  }

  async stopChannel(userId: string, channel: { id: string; resourceId: string }): Promise<void> {
    const calendar = await this.calendarFor(userId);
    await calendar.channels.stop({ requestBody: { id: channel.id, resourceId: channel.resourceId } });
  }

  /** Google representation of a Flowlio event: its day and whole hours in the user's time zone. */
  async toGoogleEvent(userId: string, appEvent: any): Promise<GoogleCalendarEvent> {
    const userTimezone = await this.getUserTimezone(userId);
    const day = dayIn(new Date(appEvent.date), userTimezone);
    const at = (hour: number) => `${day}T${String(hour).padStart(2, "0")}:00:00`;

    return {
      summary: appEvent.title,
      description: appEvent.description || "",
      start: { dateTime: at(appEvent.startHour), timeZone: userTimezone },
      end: { dateTime: at(appEvent.endHour), timeZone: userTimezone },
      location: appEvent.location,
    };
  }

  /**
   * Sync app event to Google Calendar
   */
  async syncAppEventToGoogle(
    userId: string,
    appEvent: any,
    calendarId: string = "primary",
  ): Promise<calendar_v3.Schema$Event | null> {
    try {
      const googleEvent: GoogleCalendarEvent = {
        id: googleIdFor(String(appEvent.id)),
        ...(await this.toGoogleEvent(userId, appEvent)),
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
        googleEvent,
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
    organizationId: string,
  ): Promise<any> {
    try {
      const userTimezone = await this.getUserTimezone(userId);
      const times = fromGoogleTimes(googleEvent, userTimezone);
      if (!times) {
        throw new Error("Invalid event start or end time");
      }

      const [createdEvent] = await database
        .insert(calendarEvents)
        .values({
          id: crypto.randomUUID(),
          title: googleEvent.summary || "Untitled Event",
          description: googleEvent.description || "",
          // Local midnight of the day, matching how the Calendar page reads dates.
          date: zonedMidnight(times.day, userTimezone),
          startHour: times.startHour,
          endHour: times.endHour,
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
        })
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

export const googleCalendarService = new GoogleCalendarService();
