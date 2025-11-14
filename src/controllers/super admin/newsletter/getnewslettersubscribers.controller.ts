import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { newsletterSubscribers } from "@/schema/schema";
import { eq, desc, and, like, count } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

/**
 * Get all newsletter subscribers (admin only)
 * Supports pagination and filtering
 */
export const getNewsletterSubscribers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = (req.query.search as string) || "";
    const subscribed = req.query.subscribed as string | undefined;

    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];

    if (search) {
      conditions.push(like(newsletterSubscribers.email, `%${search}%`));
    }

    if (subscribed !== undefined) {
      const isSubscribed = subscribed === "true";
      conditions.push(eq(newsletterSubscribers.subscribed, isSubscribed));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Get total count
    const totalCountResult = await database
      .select({ count: count() })
      .from(newsletterSubscribers)
      .where(whereClause);

    // Get subscribers with pagination
    const subscribers = await database
      .select()
      .from(newsletterSubscribers)
      .where(whereClause)
      .orderBy(desc(newsletterSubscribers.createdAt))
      .limit(limit)
      .offset(offset);

    const total = totalCountResult[0]?.count || 0;

    logger.info(
      `Fetched ${subscribers.length} newsletter subscribers (page ${page})`
    );

    res.status(200).json({
      success: true,
      message: "Newsletter subscribers fetched successfully",
      data: {
        subscribers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching newsletter subscribers:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch newsletter subscribers",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Delete a newsletter subscriber (admin only)
 */
export const deleteNewsletterSubscriber = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Subscriber ID is required",
      });
      return;
    }

    // Check if subscriber exists
    const subscriber = await database
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.id, id))
      .limit(1);

    if (subscriber.length === 0) {
      res.status(404).json({
        success: false,
        message: "Subscriber not found",
      });
      return;
    }

    // Delete subscriber
    await database
      .delete(newsletterSubscribers)
      .where(eq(newsletterSubscribers.id, id));

    logger.info(`Deleted newsletter subscriber: ${subscriber[0].email}`);

    res.status(200).json({
      success: true,
      message: "Subscriber deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting newsletter subscriber:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete subscriber",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Get newsletter subscriber statistics (admin only)
 */
export const getNewsletterStats = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    // Get all subscribers
    const allSubscribers = await database.select().from(newsletterSubscribers);

    const total = allSubscribers.length;
    const subscribed = allSubscribers.filter((s) => s.subscribed).length;
    const unsubscribed = total - subscribed;

    // Get subscribers by month (last 12 months)
    const now = new Date();
    const monthlyStats = Array.from({ length: 12 }, (_, i) => {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const nextMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const monthSubscribers = allSubscribers.filter((s) => {
        const subDate = new Date(s.subscribedAt);
        return subDate >= date && subDate < nextMonth;
      });

      return {
        month: date.toLocaleString("default", {
          month: "long",
          year: "numeric",
        }),
        count: monthSubscribers.length,
      };
    }).reverse();

    logger.info("Fetched newsletter statistics");

    res.status(200).json({
      success: true,
      message: "Newsletter statistics fetched successfully",
      data: {
        total,
        subscribed,
        unsubscribed,
        monthlyStats,
      },
    });
  } catch (error) {
    logger.error("Error fetching newsletter statistics:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to fetch newsletter statistics",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
