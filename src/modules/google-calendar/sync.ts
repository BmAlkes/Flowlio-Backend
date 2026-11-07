import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { calendar_v3 } from 'googleapis';
import { and, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@/schema/schema';
import { calendarEvents, googleCalendarSyncState, notifications, userOrganizations, users } from '@/schema/schema';
import { appIdFromGoogle, dayIn, fromGoogleTimes, zonedMidnight } from '@/services/googleCalendar.service';
import { logger } from '@/utils/logger.util';

type Db = NodePgDatabase<typeof schema>;
type AppEvent = typeof calendarEvents.$inferSelect;
export type GoogleApi = {
 connected(userId: string): Promise<boolean>;
 timeZone(userId: string): Promise<string>;
 listChanges(userId: string, from: { syncToken: string } | { timeMin: string; timeMax: string }): Promise<{ items: calendar_v3.Schema$Event[]; nextSyncToken: string | null }>;
 importEvent(userId: string, event: calendar_v3.Schema$Event, organizationId: string): Promise<AppEvent>;
 pushEvent(userId: string, event: AppEvent): Promise<unknown>;
 watch(userId: string, channel: { id: string; token: string; address: string }): Promise<{ resourceId: string; expiration: Date }>;
 stop(userId: string, channel: { id: string; resourceId: string }): Promise<void>;
};
const day = 86400000;
// Only events in this range are copied into Flowlio. Changes and deletions of events already
// linked are applied wherever they fall, and nothing is ever deleted just for being missing from a list.
const importWindow = (now: number) => ({ timeMin: new Date(now - 7 * day).toISOString(), timeMax: new Date(now + 180 * day).toISOString() });

export function createCalendarSync(db: Db, api: GoogleApi, options: { webhookUrl?: string; now?: () => number } = {}) {
 const now = options.now ?? Date.now;
 async function saveState(userId: string, values: Partial<typeof googleCalendarSyncState.$inferInsert>) {
  await db.insert(googleCalendarSyncState).values({ userId, ...values, updatedAt: new Date() })
   .onConflictDoUpdate({ target: googleCalendarSyncState.userId, set: { ...values, updatedAt: new Date() } });
 }

 async function notifyOrganization(userId: string, organizationId: string, event: AppEvent) {
  const [owner] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  const members = await db.select({ userId: userOrganizations.userId }).from(userOrganizations)
   .where(and(eq(userOrganizations.organizationId, organizationId), eq(userOrganizations.status, 'active'), ne(userOrganizations.userId, userId)));
  if (!members.length) return;
  await db.insert(notifications).values(members.map(m => ({
   id: randomUUID(), userId: m.userId, organizationId, type: 'calendar_event_synced', read: false, createdAt: new Date(),
   title: 'New Calendar Event Synced',
   message: `A new calendar event "${event.title}" was synced from ${owner?.name || owner?.email || 'Calendar Owner'}'s Google Calendar`,
   data: { eventId: event.id, eventTitle: event.title, eventDate: event.date, calendarType: event.calendarType, platform: event.platform, syncedFrom: owner?.email, source: 'google_calendar' },
  })));
 }

 async function applyChange(userId: string, timeZone: string, item: calendar_v3.Schema$Event, initial: boolean) {
  if (!item.id) return;
  const linked = await db.select().from(calendarEvents).where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.googleEventId, item.id)));
  if (item.status === 'cancelled') {
   if (linked.length) await db.delete(calendarEvents).where(and(eq(calendarEvents.userId, userId), eq(calendarEvents.googleEventId, item.id)));
   return;
  }
  const times = fromGoogleTimes(item, timeZone);
  if (!times) return;
  for (const row of linked) {
   // Edits made in Flowlio before this sync existed may have reached Google with the wrong hour:
   // the first pass only links those, later passes apply real changes made in Google.
   if (initial && row.syncDirection !== 'google_to_app') continue;
   const patch: Partial<AppEvent> = {};
   if ((item.summary || 'Untitled Event') !== row.title) patch.title = item.summary || 'Untitled Event';
   if ((item.description || '') !== (row.description || '')) patch.description = item.description || '';
   if (times.day !== dayIn(row.date, timeZone)) patch.date = zonedMidnight(times.day, timeZone);
   if (!times.allDay && times.endHour > times.startHour && (times.startHour !== row.startHour || times.endHour !== row.endHour)) Object.assign(patch, { startHour: times.startHour, endHour: times.endHour });
   if (Object.keys(patch).length) await db.update(calendarEvents).set({ ...patch, syncStatus: 'synced', lastSyncAt: new Date(), updatedAt: new Date() }).where(eq(calendarEvents.id, row.id));
  }
  if (linked.length) return;
  // Pushed from Flowlio (its id is the Flowlio id). Link it if the link was never saved;
  // if the Flowlio event is gone, it was deleted on purpose and must not come back.
  const flowlioId = appIdFromGoogle(item.id);
  if (flowlioId) {
   await db.update(calendarEvents).set({ googleEventId: item.id, googleCalendarId: 'primary', syncStatus: 'synced', lastSyncAt: new Date() })
    .where(and(eq(calendarEvents.id, flowlioId), eq(calendarEvents.userId, userId), isNull(calendarEvents.googleEventId)));
   return;
  }
  const start = zonedMidnight(times.day, timeZone).getTime();
  if (start < now() - 8 * day || start > now() + 181 * day) return;
  const [membership] = await db.select({ organizationId: userOrganizations.organizationId }).from(userOrganizations)
   .where(and(eq(userOrganizations.userId, userId), eq(userOrganizations.status, 'active'))).limit(1);
  if (!membership) return;
  const created = await api.importEvent(userId, item, membership.organizationId);
  if (!initial) await notifyOrganization(userId, membership.organizationId, created).catch(error => logger.error('Failed to notify about a synced Google Calendar event', { userId, errorMessage: error instanceof Error ? error.message : 'Unknown error' }));
 }

 // Flowlio events whose push to Google never happened or failed. Recent ones are left to the
 // request that created them, and failures are retried at most hourly.
 async function pushPending(userId: string) {
  const cutoff = new Date(now() - 2 * 60000);
  const rows = await db.select().from(calendarEvents).where(and(
   eq(calendarEvents.userId, userId), isNull(calendarEvents.googleEventId), lt(calendarEvents.createdAt, cutoff),
   gte(calendarEvents.date, new Date(now() - 30 * day)),
   or(isNull(calendarEvents.syncStatus), ne(calendarEvents.syncStatus, 'failed'), isNull(calendarEvents.lastSyncAt), lt(calendarEvents.lastSyncAt, new Date(now() - 3600000))),
  )).limit(50);
  for (const row of rows) await api.pushEvent(userId, row);
 }

 async function ensureChannel(userId: string, state: typeof googleCalendarSyncState.$inferSelect | undefined) {
  if (!options.webhookUrl) return;
  if (state?.channelId && state.channelExpiresAt && state.channelExpiresAt.getTime() > now() + day) return;
  const channel = { id: randomUUID(), token: randomBytes(24).toString('base64url'), address: options.webhookUrl };
  const created = await api.watch(userId, channel);
  await saveState(userId, { channelId: channel.id, channelToken: channel.token, channelResourceId: created.resourceId, channelExpiresAt: created.expiration });
  if (state?.channelId && state.channelResourceId) await api.stop(userId, { id: state.channelId, resourceId: state.channelResourceId }).catch(() => {});
 }

 /** Two-way sync of one user's primary calendar. Never throws: failures are logged and kept on the state row. */
 async function syncUser(userId: string) {
  try {
   if (!(await api.connected(userId))) return;
   const timeZone = await api.timeZone(userId);
   const [state] = await db.select().from(googleCalendarSyncState).where(eq(googleCalendarSyncState.userId, userId));
   let feed = null;
   if (state?.syncToken) {
    try { feed = await api.listChanges(userId, { syncToken: state.syncToken }); }
    catch (error) { if ((error as { code?: number })?.code !== 410) throw error; }
   }
   const initial = !feed;
   feed ??= await api.listChanges(userId, importWindow(now()));
   for (const item of feed.items) await applyChange(userId, timeZone, item, initial);
   await pushPending(userId);
   await saveState(userId, { syncToken: feed.nextSyncToken ?? state?.syncToken ?? null, lastSyncedAt: new Date(now()), lastError: null });
   await ensureChannel(userId, state);
  } catch (error) {
   const message = error instanceof Error ? error.message.slice(0, 500) : 'Unknown error';
   logger.warn('Google Calendar sync failed', { userId, errorMessage: message });
   await saveState(userId, { lastError: message }).catch(() => {});
  }
 }

 /** Stop push notifications and forget the sync position, before the Google account is removed. */
 async function forget(userId: string) {
  const [state] = await db.select().from(googleCalendarSyncState).where(eq(googleCalendarSyncState.userId, userId));
  if (state?.channelId && state.channelResourceId) await api.stop(userId, { id: state.channelId, resourceId: state.channelResourceId }).catch(() => {});
  await db.delete(googleCalendarSyncState).where(eq(googleCalendarSyncState.userId, userId));
 }

 /** The user a push notification belongs to, or null when the channel or its token is unknown. */
 async function notificationOwner(channelId: string | undefined, token: string | undefined) {
  if (!channelId || !token) return null;
  const [state] = await db.select({ userId: googleCalendarSyncState.userId, token: googleCalendarSyncState.channelToken })
   .from(googleCalendarSyncState).where(eq(googleCalendarSyncState.channelId, channelId));
  if (!state?.token) return null;
  const expected = Buffer.from(state.token), given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? state.userId : null;
 }

 async function connectedUsers() {
  return (await db.execute<{ user_id: string }>(sql`select distinct user_id from account where provider_id='google' and refresh_token is not null`)).rows.map(r => r.user_id);
 }

 return { syncUser, forget, notificationOwner, connectedUsers };
}
