import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { pushSubscriptions } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const pushSubscribe = async (req: Request, res: Response) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid subscription object" });
  }

  const userId = req.user!.id;
  const { endpoint, keys } = parsed.data;

  // Delete any existing entry for this endpoint (may belong to previous user session)
  await database.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));

  await database.insert(pushSubscriptions).values({
    id: crypto.randomUUID(),
    userId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    createdAt: new Date(),
  });

  return res.status(201).json({ success: true, message: "Push subscription saved" });
};
