import { Response } from "express";
import { calendarEvents, userOrganizations, notifications } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { createCalendarEventSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";
import { z } from "zod";
import { googleCalendarService } from "../../../services/googleCalendar.service";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

interface CreateCalendarEventRequest {
  body: z.infer<typeof createCalendarEventSchema>;
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const createCalendarEvent = async (
  req: CreateCalendarEventRequest,
  res: Response
): Promise<void> => {
  try {
    // Log the incoming request for debugging
    logger.info("Creating calendar event - Request body:", {
      body: req.body,
      bodyKeys: Object.keys(req.body || {}),
    });

    // Validate request body
    let validatedData;
    try {
      validatedData = createCalendarEventSchema.parse(req.body);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        logger.error("Validation error details:", {
          errors: validationError.errors,
          receivedData: req.body,
        });
        res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationError.errors,
          receivedData: req.body, // Include received data for debugging
        });
        return;
      }
      throw validationError;
    }

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    // Create calendar event
    const eventData = {
      id: randomUUID(),
      title: validatedData.title,
      description: validatedData.description,
      date: new Date(validatedData.date),
      startHour: validatedData.startHour,
      endHour: validatedData.endHour,
      calendarType: validatedData.calendarType,
      platform: validatedData.platform,
      meetLink: validatedData.meetLink || null,
      whatsappNumber: validatedData.whatsappNumber || null,
      outlookEvent: validatedData.outlookEvent || null,
      organizationId: req.user.organizationId,
      userId: req.user.id,
    };

    const [newEvent] = await database
      .insert(calendarEvents)
      .values(eventData)
      .returning();

    logger.info("Calendar event created successfully:", {
      eventId: newEvent.id,
      userId: req.user.id,
      organizationId: req.user.organizationId,
    });

    // Try to sync the event to Google Calendar if user is connected
    try {
      logger.info("Starting Google Calendar sync process:", {
        eventId: newEvent.id,
        userId: req.user.id,
      });

      const hasCredentials = await googleCalendarService.setCredentials(
        req.user.id
      );

      logger.info("Google Calendar credentials check:", {
        eventId: newEvent.id,
        userId: req.user.id,
        hasCredentials,
      });

      if (hasCredentials) {
        logger.info("Syncing new event to Google Calendar:", {
          eventId: newEvent.id,
          userId: req.user.id,
        });

        const googleEvent = await googleCalendarService.syncAppEventToGoogle(
          req.user.id,
          newEvent,
          "primary"
        );

        if (googleEvent) {
          // Update the local event with Google Calendar data
          await database
            .update(calendarEvents)
            .set({
              googleEventId: googleEvent.id,
              googleCalendarId: "primary",
              syncStatus: "synced",
              lastSyncAt: new Date(),
              googleEventData: {
                htmlLink: googleEvent.htmlLink || undefined,
                hangoutLink: googleEvent.hangoutLink || undefined,
                location: googleEvent.location || undefined,
                recurrence: googleEvent.recurrence || undefined,
              },
            })
            .where(eq(calendarEvents.id, newEvent.id));

          logger.info("Event synced to Google Calendar successfully:", {
            eventId: newEvent.id,
            googleEventId: googleEvent.id,
          });
        }
      } else {
        logger.info("User not connected to Google Calendar, skipping sync:", {
          eventId: newEvent.id,
          userId: req.user.id,
        });
      }
    } catch (syncError) {
      logger.error("Failed to sync event to Google Calendar:", {
        eventId: newEvent.id,
        userId: req.user.id,
        error: syncError,
        errorMessage:
          syncError instanceof Error ? syncError.message : "Unknown error",
        errorStack: syncError instanceof Error ? syncError.stack : undefined,
      });
      // Don't fail the creation if sync fails
    }

    // Send notifications to all organization users (except the creator)
    try {
      const organizationId = req.user?.organizationId;
      const creatorId = req.user?.id;
      
      if (organizationId) {
        // Get all active users in the organization
        const orgUsers = await database
          .select({
            userId: userOrganizations.userId,
          })
          .from(userOrganizations)
          .where(
            and(
              eq(userOrganizations.organizationId, organizationId),
              eq(userOrganizations.status, "active")
            )
          );

        // Create notifications for all users except the creator
        const notificationPromises = orgUsers
          .filter((orgUser) => orgUser.userId !== creatorId)
          .map((orgUser) =>
            database.insert(notifications).values({
              id: randomUUID(),
              userId: orgUser.userId,
              organizationId: organizationId,
              type: "calendar_event_created",
              title: "New Calendar Event Created",
              message: `${req.user?.email || "A user"} created a new calendar event: ${validatedData.title}`,
              data: {
                eventId: newEvent.id,
                eventTitle: validatedData.title,
                eventDate: validatedData.date,
                calendarType: validatedData.calendarType,
                platform: validatedData.platform,
                createdBy: req.user?.email || "Unknown",
              },
              read: false,
              createdAt: new Date(),
            })
          );

        if (notificationPromises.length > 0) {
          await Promise.all(notificationPromises);
          logger.info(
            `Notifications sent to ${notificationPromises.length} organization users for calendar event creation`,
            {
              eventId: newEvent.id,
              organizationId,
              creatorId,
            }
          );
        }
      }
    } catch (notificationError) {
      // Log error but don't fail the event creation
      logger.error("Failed to send notifications for calendar event:", {
        error: notificationError,
        eventId: newEvent.id,
        userId: req.user?.id,
      });
    }

    // Log activity
    try {
      const userId = req.user?.id;
      const organizationId = req.user?.organizationId;
      if (organizationId && userId) {
        await logActivity({
          organizationId,
          actorId: userId,
          type: "calendar",
          action: "create",
          resource: "calendar_event",
          resourceId: newEvent.id,
          message: `Created calendar event: ${validatedData.title}`,
          metadata: {
            date: validatedData.date,
            calendarType: validatedData.calendarType,
            platform: validatedData.platform,
          },
        });
        logger.info(
          "Activity logged successfully for calendar event creation:",
          {
            eventId: newEvent.id,
            organizationId,
            userId,
          }
        );
      }
    } catch (activityError) {
      // Log error but don't fail the event creation
      logger.error("Failed to log activity for calendar event:", {
        error: activityError,
        eventId: newEvent.id,
        userId: req.user?.id,
      });
    }

    res.status(201).json({
      success: true,
      message: "Calendar event created successfully",
      data: newEvent,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("Validation error in create calendar event:", error.errors);
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
      return;
    }

    logger.error("Error creating calendar event:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create calendar event",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
