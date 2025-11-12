import { Request, Response } from "express";
import { backgroundSyncService } from "../../../services/backgroundSync.service";
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

    await backgroundSyncService.forceSyncUser(req.user.id);

    res.status(200).json({
      success: true,
      message: "User sync completed successfully",
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
    const status = backgroundSyncService.getSyncStatus();

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

    backgroundSyncService.startPeriodicSync(intervalMinutes);

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

    backgroundSyncService.stopPeriodicSync();

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
