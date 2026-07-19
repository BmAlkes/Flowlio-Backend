import webpush from "web-push";
import { database } from "@/configs/connection.config";
import { pushSubscriptions } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.util";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:support@flowlioapp.com",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

export const sendPushToUser = async (
  userId: string,
  payload: { title: string; body: string; icon?: string; data?: Record<string, unknown> },
): Promise<void> => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  let subscriptions: { endpoint: string; p256dh: string; auth: string }[];
  try {
    subscriptions = await database
      .select({ endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
  } catch (err) {
    logger.error("Failed to fetch push subscriptions:", err);
    return;
  }

  if (subscriptions.length === 0) return;

  const payloadStr = JSON.stringify({
    icon: "/logo/logo.png",
    data: { url: "https://flowlioapp.com/dashboard/inbox" },
    ...payload,
  });

  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadStr,
        );
      } catch (err: any) {
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          try {
            await database
              .delete(pushSubscriptions)
              .where(eq(pushSubscriptions.endpoint, sub.endpoint));
            logger.info(`Removed expired push subscription for user ${userId}`);
          } catch (deleteErr) {
            logger.error("Failed to delete expired push subscription:", deleteErr);
          }
        } else {
          logger.error("Push notification send error:", err);
        }
      }
    }),
  );
};
