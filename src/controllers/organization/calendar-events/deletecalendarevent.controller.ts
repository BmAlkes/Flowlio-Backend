import { Request, Response } from "express";
import { calendarEvents } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { googleCalendarService } from "../../../services/googleCalendar.service";
import { logActivity } from "@/utils/activity.util";

interface DeleteCalendarEventRequest extends Request {
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

export const deleteCalendarEvent = async (
  req: DeleteCalendarEventRequest,
  res: Response
): Promise<void> => {
  try {
    logger.info("Delete request details:", {
      method: req.method,
      url: req.url,
      params: req.params,
      userId: req.user?.id,
      hasUser: !!req.user,
    });

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { organizationId, id: userId } = req.user;
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Event ID is required",
      });
      return;
    }

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

    const eventToDelete = existingEvent[0];

    // Log activity before deletion
    if (organizationId && eventToDelete) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "calendar",
        action: "delete",
        resource: "calendar_event",
        resourceId: id,
        message: `Deleted calendar event: ${eventToDelete.title}`,
        metadata: {
          date: eventToDelete.date,
          calendarType: eventToDelete.calendarType,
        },
      });
    }

    // If the event has a Google Calendar ID, delete it from Google Calendar first
    if (eventToDelete.googleEventId && eventToDelete.googleCalendarId) {
      try {
        await googleCalendarService.setCredentials(req.user.id);
        await googleCalendarService.deleteEvent(
          req.user.id,
          eventToDelete.googleCalendarId,
          eventToDelete.googleEventId
        );
      } catch (googleError) {
        logger.error("Failed to delete event from Google Calendar:", {
          eventId: id,
          googleEventId: eventToDelete.googleEventId,
          error: googleError,
        });
        // Continue with local deletion even if Google deletion fails
      }
    }

    // Delete the calendar event from local database
    await database
      .delete(calendarEvents)
      .where(
        and(
          eq(calendarEvents.id, id),
          eq(calendarEvents.userId, userId),
          ...(organizationId
            ? [eq(calendarEvents.organizationId, organizationId as string)]
            : [])
        )
      );

    res.status(200).json({
      success: true,
      message: "Calendar event deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting calendar event:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete calendar event",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
