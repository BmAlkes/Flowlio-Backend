import { Request, Response } from "express";
import { connection } from "../../../configs/connection.config";
import { queueUserSync } from "@/modules/google-calendar";
import { logger } from "@/utils/logger.util";
import status from "http-status";

/**
 * Force sync for current user
 */
export const forceSyncUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    logger.info(`Force sync requested by user: ${req.user.id}`);

    await queueUserSync(req.user.id,"user",60000);

    res.status(202).json({
      success: true,
      message: "User sync queued successfully",
    });
  } catch (error) {
    logger.error("Error during force sync:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to perform force sync",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get background sync status
 */
export const getSyncStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }
    const result = await connection.query(`SELECT
      EXISTS(SELECT 1 FROM durable_jobs WHERE kind='calendar-sync' AND status IN ('pending','running','retry') AND payload->>'userId'=$1) AS running,
      EXISTS(SELECT 1 FROM job_schedules WHERE kind='calendar-sync' AND enabled=true) AS enabled,
      (SELECT last_synced_at FROM google_calendar_sync_state WHERE user_id=$1) AS last_synced_at,
      (SELECT last_error FROM google_calendar_sync_state WHERE user_id=$1) AS last_error,
      (SELECT channel_expires_at>now() FROM google_calendar_sync_state WHERE user_id=$1) AS live`, [req.user.id]);
    const row = result.rows[0];
    const status = {isRunning:row.running,hasInterval:row.enabled,lastSyncedAt:row.last_synced_at,lastError:row.last_error?"SYNC_FAILED":null,live:!!row.live};

    res.status(200).json({
      success: true,
      message: "Sync status retrieved successfully",
      data: status,
    });
  } catch (error) {
    logger.error("Error getting sync status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to get sync status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Start background sync (admin only)
 */
export const startBackgroundSync = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: "Admin access required",
      });
      return;
    }

    const { intervalMinutes = 15 } = req.body;

    if (!Number.isInteger(intervalMinutes) || intervalMinutes < 1 || intervalMinutes > 1440) {
      res.status(400).json({success:false,message:"Interval must be an integer between 1 and 1440 minutes"}); return;
    }
    await connection.query("INSERT INTO job_schedules (kind,next_run_at,enabled,interval_minutes) VALUES ('calendar-sync',now(),true,$1) ON CONFLICT(kind) DO UPDATE SET enabled=true,interval_minutes=$1,next_run_at=now()",[intervalMinutes]);

    res.status(200).json({
      success: true,
      message: `Background sync started with ${intervalMinutes} minute interval`,
    });
  } catch (error) {
    logger.error("Error starting background sync:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to start background sync",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Stop background sync (admin only)
 */
export const stopBackgroundSync = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.isSuperAdmin) {
      res.status(403).json({
        success: false,
        message: "Admin access required",
      });
      return;
    }

    await connection.query("INSERT INTO job_schedules (kind,next_run_at,enabled) VALUES ('calendar-sync',now(),false) ON CONFLICT(kind) DO UPDATE SET enabled=false");

    res.status(200).json({
      success: true,
      message: "Background sync stopped",
    });
  } catch (error) {
    logger.error("Error stopping background sync:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to stop background sync",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
