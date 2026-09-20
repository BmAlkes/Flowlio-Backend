import { Request, Response } from "express";
import { connection } from "../../../configs/connection.config";
import { enqueue } from "../../../services/jobs/queue";
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

    await enqueue(connection,"calendar-sync","calendar-user:"+req.user.id+":"+Math.floor(Date.now()/60000),{userId:req.user.id});

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
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const result = await connection.query("SELECT EXISTS(SELECT 1 FROM durable_jobs WHERE kind='calendar-sync' AND status='running') AS running, EXISTS(SELECT 1 FROM job_schedules WHERE kind='calendar-sync' AND enabled=true) AS enabled");
    const status = {isRunning:result.rows[0].running,hasInterval:result.rows[0].enabled};

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
