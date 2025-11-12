import { Request, Response } from "express";
import { googleCalendarService } from "../../../services/googleCalendar.service";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { env } from "@/utils/env.util";
import { database } from "../../../configs/connection.config";
import { account } from "@/schema/schema";
import { eq, and } from "drizzle-orm";

/**
 * Generate Google Calendar OAuth URL
 */
export const generateGoogleAuthUrl = async (
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

    const authUrl = googleCalendarService.generateAuthUrl(req.user.id);

    // logger.info("Google Calendar auth URL generated", {
    //   userId: req.user.id,
    // });

    res.status(200).json({
      success: true,
      message: "Google Calendar auth URL generated successfully",
      data: {
        authUrl,
      },
    });
  } catch (error) {
    logger.error("Error generating Google Calendar auth URL:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to generate Google Calendar auth URL",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Handle Google Calendar OAuth callback
 */
export const handleGoogleAuthCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { code, state: userId } = req.query;

    if (!code || !userId) {
      res.status(400).json({
        success: false,
        message: "Missing authorization code or user ID",
      });
      return;
    }

    await googleCalendarService.exchangeCodeForTokens(
      code as string,
      userId as string
    );

    // logger.info("Google Calendar tokens exchanged successfully", {
    //   userId: userId as string,
    // });

    // Redirect to frontend with success message
    res.redirect(
      `${env.FRONTEND_DOMAIN}/dashboard/calender?google_auth=success`
    );
  } catch (error) {
    logger.error("Error handling Google Calendar auth callback:", error);

    // Redirect to frontend with error message
    res.redirect(`${env.FRONTEND_DOMAIN}/dashboard/calender?google_auth=error`);
  }
};

/**
 * Check Google Calendar connection status
 */
export const checkGoogleCalendarStatus = async (
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

    const tokens = await googleCalendarService.getUserTokens(req.user.id);
    const isConnected = !!tokens;

    // logger.info("Google Calendar status checked", {
    //   userId: req.user.id,
    //   isConnected,
    // });

    res.status(200).json({
      success: true,
      message: "Google Calendar status checked successfully",
      data: {
        isConnected,
        hasTokens: !!tokens,
      },
    });
  } catch (error) {
    logger.error("Error checking Google Calendar status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to check Google Calendar status",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Disconnect Google Calendar
 */
export const disconnectGoogleCalendar = async (
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

    // Remove tokens from database by deleting the account record
    await database
      .delete(account)
      .where(
        and(eq(account.userId, req.user.id), eq(account.providerId, "google"))
      );

    res.status(200).json({
      success: true,
      message: "Google Calendar disconnected successfully",
    });
  } catch (error) {
    logger.error("Error disconnecting Google Calendar:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to disconnect Google Calendar",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
