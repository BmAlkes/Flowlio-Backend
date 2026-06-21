import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { leadWebhookLogs } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const retryWebhookLog = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { logId } = req.params;

    const [log] = await database
      .select()
      .from(leadWebhookLogs)
      .where(eq(leadWebhookLogs.id, logId))
      .limit(1);

    if (!log) {
      res.status(404).json({ success: false, message: "Webhook log not found" });
      return;
    }

    if (log.status === "success" || log.status === "retried_success") {
      res.status(400).json({ success: false, message: "Log already succeeded" });
      return;
    }

    // Reset retry count and mark for immediate reprocessing
    await database
      .update(leadWebhookLogs)
      .set({
        status: "pending_retry" as any,
        retryCount: 0,
        nextRetryAt: new Date(),
      })
      .where(eq(leadWebhookLogs.id, logId));

    logger.info(`Manual retry queued for webhook log ${logId}`);

    res.status(200).json({
      success: true,
      message: "Retry queued. The webhook will be reprocessed shortly.",
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to queue retry" });
  }
};
