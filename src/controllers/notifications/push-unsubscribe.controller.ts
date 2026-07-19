import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { pushSubscriptions } from "@/schema/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export const pushUnsubscribe = async (req: Request, res: Response) => {
  const parsed = unsubscribeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid request" });
  }

  const userId = req.user!.id;
  const { endpoint } = parsed.data;

  await database
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));

  return res.json({ success: true, message: "Unsubscribed from push notifications" });
};
