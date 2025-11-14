import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { newsletterSubscribers } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import crypto from "crypto";

// Email validation regex
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Subscribe to newsletter
 * Public endpoint - no authentication required
 */
export const subscribeToNewsletter = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || typeof email !== "string") {
      res.status(400).json({
        success: false,
        message: "Email is required",
      });
      return;
    }

    // Validate email format
    const trimmedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(trimmedEmail)) {
      res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
      return;
    }

    // Check if email already exists
    const existingSubscriber = await database
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, trimmedEmail))
      .limit(1);

    if (existingSubscriber.length > 0) {
      const subscriber = existingSubscriber[0];

      // If already subscribed, return success
      if (subscriber.subscribed) {
        res.status(200).json({
          success: true,
          message: "You are already subscribed to our newsletter",
          data: {
            email: subscriber.email,
            subscribed: true,
          },
        });
        return;
      }

      // If unsubscribed, resubscribe them
      const subscriberId = subscriber.id;
      await database
        .update(newsletterSubscribers)
        .set({
          subscribed: true,
          subscribedAt: new Date(),
          unsubscribedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(newsletterSubscribers.id, subscriberId));

      logger.info(`Newsletter resubscription: ${trimmedEmail}`);

      res.status(200).json({
        success: true,
        message: "Successfully resubscribed to newsletter",
        data: {
          email: trimmedEmail,
          subscribed: true,
        },
      });
      return;
    }

    // Create new subscriber
    const subscriberId = crypto.randomUUID();
    try {
      await database.insert(newsletterSubscribers).values({
        id: subscriberId,
        email: trimmedEmail,
        subscribed: true,
        subscribedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (insertError: any) {
      // Handle unique constraint violation (race condition)
      if (
        insertError?.code === "23505" ||
        insertError?.message?.includes("unique")
      ) {
        // Email was inserted between our check and insert, fetch the existing record
        const raceConditionSubscriber = await database
          .select()
          .from(newsletterSubscribers)
          .where(eq(newsletterSubscribers.email, trimmedEmail))
          .limit(1);

        if (raceConditionSubscriber.length > 0) {
          const subscriber = raceConditionSubscriber[0];
          if (subscriber.subscribed) {
            res.status(200).json({
              success: true,
              message: "You are already subscribed to our newsletter",
              data: {
                email: subscriber.email,
                subscribed: true,
              },
            });
            return;
          } else {
            // Resubscribe them
            await database
              .update(newsletterSubscribers)
              .set({
                subscribed: true,
                subscribedAt: new Date(),
                unsubscribedAt: null,
                updatedAt: new Date(),
              })
              .where(eq(newsletterSubscribers.id, subscriber.id));

            res.status(200).json({
              success: true,
              message: "Successfully resubscribed to newsletter",
              data: {
                email: trimmedEmail,
                subscribed: true,
              },
            });
            return;
          }
        }
      }
      // Re-throw if it's not a unique constraint error
      throw insertError;
    }

    logger.info(`New newsletter subscription: ${trimmedEmail}`);

    res.status(201).json({
      success: true,
      message: "Successfully subscribed to newsletter",
      data: {
        email: trimmedEmail,
        subscribed: true,
      },
    });
  } catch (error: any) {
    logger.error("Error subscribing to newsletter:", error);
    logger.error("Error details:", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      error: error,
    });

    // Provide more specific error messages
    let errorMessage = "Failed to subscribe to newsletter";
    if (error?.code === "23505") {
      errorMessage = "This email is already subscribed";
    } else if (error?.code === "42P01") {
      errorMessage = "Database table not found. Please run migrations.";
    } else if (error?.message) {
      errorMessage = error.message;
    }

    res.status(500).json({
      success: false,
      message: errorMessage,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Unsubscribe from newsletter
 * Public endpoint - no authentication required
 */
export const unsubscribeFromNewsletter = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { email } = req.body;

    // Validate email
    if (!email || typeof email !== "string") {
      res.status(400).json({
        success: false,
        message: "Email is required",
      });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Find subscriber
    const existingSubscriber = await database
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, trimmedEmail))
      .limit(1);

    if (existingSubscriber.length === 0) {
      res.status(404).json({
        success: false,
        message: "Email not found in our newsletter list",
      });
      return;
    }

    const subscriber = existingSubscriber[0];

    if (!subscriber.subscribed) {
      res.status(200).json({
        success: true,
        message: "You are already unsubscribed",
      });
      return;
    }

    // Unsubscribe
    await database
      .update(newsletterSubscribers)
      .set({
        subscribed: false,
        unsubscribedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(newsletterSubscribers.id, subscriber.id));

    logger.info(`Newsletter unsubscription: ${trimmedEmail}`);

    res.status(200).json({
      success: true,
      message: "Successfully unsubscribed from newsletter",
    });
  } catch (error) {
    logger.error("Error unsubscribing from newsletter:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unsubscribe from newsletter",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
