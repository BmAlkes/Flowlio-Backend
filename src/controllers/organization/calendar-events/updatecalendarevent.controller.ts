import { Request, Response } from "express";
import {
  calendarEvents,
  userOrganizations,
  notifications,
} from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";
import { googleCalendarService } from "../../../services/googleCalendar.service";
import { logActivity } from "@/utils/activity.util";
import { randomUUID } from "crypto";

interface UpdateCalendarEventRequest extends Request {
  user?: {
    id: string;
    organizationId?: string;
    role: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isSuperAdmin: boolean;
    createdAt: Date;
    updatedAt: Date;
    organization?: any;
    userOrganization?: any;
  };
}

export const updateCalendarEvent = async (
  req: UpdateCalendarEventRequest,
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

    const { organizationId, id: userId } = req.user;
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Event ID is required",
      });
      return;
    }

    // Event must belong to this user (private calendar)
    const existingEvent = await database
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, id),
          eq(calendarEvents.userId, userId),
          ...(organizationId
            ? [eq(calendarEvents.organizationId, organizationId as string)]
            : [])
        )
      )
      .limit(1);

    if (existingEvent.length === 0) {
      res.status(404).json({
        success: false,
        message: "Calendar event not found",
      });
      return;
    }

    // Validation for hours if provided
    if (
      updateData.startHour !== undefined &&
      updateData.endHour !== undefined
    ) {
      if (updateData.startHour >= updateData.endHour) {
        res.status(400).json({
          success: false,
          message: "End hour must be after start hour",
        });
        return;
      }

      if (
        updateData.startHour < 0 ||
        updateData.startHour > 23 ||
        updateData.endHour < 0 ||
        updateData.endHour > 23
      ) {
        res.status(400).json({
          success: false,
          message: "Hours must be between 0 and 23",
        });
        return;
      }
    }

    // Prepare update data
    const eventUpdateData: any = {
      updatedAt: new Date(),
    };

    if (updateData.title !== undefined)
      eventUpdateData.title = updateData.title;
    if (updateData.description !== undefined)
      eventUpdateData.description = updateData.description;
    if (updateData.date !== undefined)
      eventUpdateData.date = new Date(updateData.date);
    if (updateData.startHour !== undefined)
      eventUpdateData.startHour = updateData.startHour;
    if (updateData.endHour !== undefined)
      eventUpdateData.endHour = updateData.endHour;
    if (updateData.calendarType !== undefined)
      eventUpdateData.calendarType = updateData.calendarType;
    if (updateData.platform !== undefined)
      eventUpdateData.platform = updateData.platform;
    if (updateData.meetLink !== undefined)
      eventUpdateData.meetLink = updateData.meetLink;
    if (updateData.whatsappNumber !== undefined)
      eventUpdateData.whatsappNumber = updateData.whatsappNumber;
    if (updateData.outlookEvent !== undefined)
      eventUpdateData.outlookEvent = updateData.outlookEvent;

    // Update the calendar event
    const [updatedEvent] = await database
      .update(calendarEvents)
      .set(eventUpdateData)
      .where(
        and(
          eq(calendarEvents.id, id),
          eq(calendarEvents.userId, userId),
          ...(organizationId
            ? [eq(calendarEvents.organizationId, organizationId as string)]
            : [])
        )
      )
      .returning();

    // Try to sync the updated event to Google Calendar if user is connected
    try {
      const hasCredentials = await googleCalendarService.setCredentials(
        req.user.id
      );

      if (hasCredentials && updatedEvent.googleEventId) {
        // Update the event in Google Calendar
        await googleCalendarService.updateEvent(
          req.user.id,
          updatedEvent.googleCalendarId || "primary",
          updatedEvent.googleEventId,
          {
            summary: updatedEvent.title,
            description: updatedEvent.description || undefined,
            start: {
              dateTime: new Date(
                new Date(updatedEvent.date).setHours(
                  updatedEvent.startHour,
                  0,
                  0,
                  0
                )
              ).toISOString(),
              timeZone: "UTC",
            },
            end: {
              dateTime: new Date(
                new Date(updatedEvent.date).setHours(
                  updatedEvent.endHour,
                  0,
                  0,
                  0
                )
              ).toISOString(),
              timeZone: "UTC",
            },
          }
        );
      } else if (hasCredentials && !updatedEvent.googleEventId) {
        // If event doesn't have Google Calendar ID, sync it as new event
        const googleEvent = await googleCalendarService.syncAppEventToGoogle(
          req.user.id,
          updatedEvent,
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
            .where(eq(calendarEvents.id, id));
        }
      }
    } catch (syncError) {
      logger.error(
        "Failed to sync updated event to Google Calendar:",
        syncError
      );
    }

    // Send notifications to all organization users (except the updater)
    try {
      const updaterId = req.user?.id;

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

        // Create notifications for all users except the updater
        const notificationPromises = orgUsers
          .filter((orgUser) => orgUser.userId !== updaterId)
          .map((orgUser) =>
            database.insert(notifications).values({
              id: randomUUID(),
              userId: orgUser.userId,
              organizationId: organizationId,
              type: "calendar_event_updated",
              title: "Calendar Event Updated",
              message: `${
                req.user?.email || "A user"
              } updated calendar event: ${updatedEvent.title}`,
              data: {
                eventId: updatedEvent.id,
                eventTitle: updatedEvent.title,
                eventDate: updatedEvent.date,
                calendarType: updatedEvent.calendarType,
                platform: updatedEvent.platform,
                updatedBy: req.user?.email || "Unknown",
                updatedFields: Object.keys(eventUpdateData),
              },
              read: false,
              createdAt: new Date(),
            })
          );

        if (notificationPromises.length > 0) {
          await Promise.all(notificationPromises);
          logger.info(
            `Notifications sent to ${notificationPromises.length} organization users for calendar event update`,
            {
              eventId: updatedEvent.id,
              organizationId,
              updaterId,
            }
          );
        }
      }
    } catch (notificationError) {
      // Log error but don't fail the event update
      logger.error("Failed to send notifications for calendar event update:", {
        error: notificationError,
        eventId: updatedEvent.id,
        userId: req.user?.id,
      });
    }

    if (organizationId && existingEvent.length > 0) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "calendar",
        action: "update",
        resource: "calendar_event",
        resourceId: id,
        message: `Updated calendar event: ${updatedEvent.title}`,
        metadata: { updatedFields: Object.keys(eventUpdateData) },
      });
    }

    res.status(200).json({
      success: true,
      message: "Calendar event updated successfully",
      data: updatedEvent,
    });
  } catch (error) {
    logger.error("Error updating calendar event:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update calendar event",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
