import type { Request, Response } from 'express';
import { connection, database } from '@/configs/connection.config';
import { googleCalendarService } from '@/services/googleCalendar.service';
import { enqueue } from '@/services/jobs/queue';
import { env } from '@/utils/env.util';
import { createCalendarSync } from './sync';

export const calendarSync = createCalendarSync(database, {
 connected: userId => googleCalendarService.setCredentials(userId),
 timeZone: userId => googleCalendarService.getUserTimezone(userId),
 listChanges: (userId, from) => googleCalendarService.listChanges(userId, from),
 importEvent: (userId, event, organizationId) => googleCalendarService.syncGoogleEventToApp(userId, event, organizationId),
 pushEvent: (userId, event) => googleCalendarService.syncAppEventToGoogle(userId, event, 'primary'),
 watch: (userId, channel) => googleCalendarService.watchEvents(userId, channel),
 stop: (userId, channel) => googleCalendarService.stopChannel(userId, channel),
}, { webhookUrl: env.GOOGLE_CALENDAR_WEBHOOK_URL });

/** Queue a sync for one user. Requests within the same window collapse into one job. */
export const queueUserSync = (userId: string, reason: string, windowMs = 10000) =>
 enqueue(connection, 'calendar-sync', `calendar-${reason}:${userId}:${Math.floor(Date.now() / windowMs)}`, { userId });

/**
 * Google calls this when a watched calendar changes. It carries no event data, only the
 * channel id and the secret token we gave Google; a valid one queues that user's sync.
 */
export async function googleCalendarWebhook(req: Request, res: Response) {
 try {
  const userId = await calendarSync.notificationOwner(req.header('x-goog-channel-id'), req.header('x-goog-channel-token'));
  if (userId && req.header('x-goog-resource-state') !== 'sync') await queueUserSync(userId, 'push');
 } catch {
  // Google retries failed deliveries; the periodic sync also covers missed ones.
  res.status(500).end();
  return;
 }
 res.status(200).end();
}
