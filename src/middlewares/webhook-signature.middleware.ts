import crypto from "crypto";
import { Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import { webhookSecrets } from "@/schema/schema";
import { eq, and } from "drizzle-orm";

export const validateWebhookSignature = async (
  req: any,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Step 1 — Check signature header
    const signature = req.headers["x-webhook-signature"] as string;
    if (!signature) {
      res.status(401).json({ error: "Missing webhook signature" });
      return;
    }

    // Step 2 — Check org ID header
    const orgId = req.headers["x-webhook-org-id"] as string;
    if (!orgId) {
      res.status(401).json({ error: "Missing organization ID" });
      return;
    }

    // Step 3 — Fetch active secret from DB
    const records = await database
      .select()
      .from(webhookSecrets)
      .where(
        and(
          eq(webhookSecrets.organizationId, orgId),
          eq(webhookSecrets.isActive, true)
        )
      )
      .limit(1);

    if (records.length === 0) {
      res.status(401).json({ error: "No active webhook secret found" });
      return;
    }

    const record = records[0];

    // Step 4 — Compute expected HMAC
    let rawBody: string;
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      rawBody = req.body;
    } else {
      rawBody = JSON.stringify(req.body);
    }
    const expectedSig = crypto
      .createHmac("sha256", record.secret)
      .update(rawBody)
      .digest("hex");

    // Step 5 — Timing-safe comparison
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSig);

    // Length must match before timingSafeEqual (it throws if lengths differ)
    if (sigBuffer.length !== expectedBuffer.length) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const isValid = crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    if (!isValid) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    // Step 6 — Attach org and proceed
    req.webhookOrgId = orgId;
    next();
  } catch (err) {
    console.error("Webhook signature validation error:", err);
    res.status(500).json({ error: "Webhook validation failed" });
  }
};
