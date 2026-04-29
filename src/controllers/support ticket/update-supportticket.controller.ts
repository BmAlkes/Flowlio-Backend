import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { supportTickets, notifications } from "@/schema/schema";
import { z } from "zod";
import status from "http-status";
import crypto from "crypto";
import { logActivity } from "@/utils/activity.util";

// Validation schema for updating support tickets
const updateSupportTicketSchema = z.object({
  subject: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  assignedToOrganization: z.string().optional(),
  assignedToUser: z.string().optional(),
  resolution: z.string().optional(),
});

export const updateSupportTicket = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id } = req.params;

    if (!id) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Ticket ID is required",
      });
      return;
    }

    // Validate request body
    const validationResult = updateSupportTicketSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.error.errors,
      });
      return;
    }

    const updateData = validationResult.data;

    // Get the existing ticket
    const existingTicket = await database.query.supportTickets.findFirst({
      where: eq(supportTickets.id, id),
    });

    if (!existingTicket) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Support ticket not found",
      });
      return;
    }

    // Check permissions
    if (user.role === "user" && existingTicket.submittedby !== user.id) {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "You don't have permission to update this ticket",
      });
      return;
    }

    if (user.role === "subadmin") {
      // Subadmin can update tickets they submitted or tickets from their organization
      const canUpdate =
        existingTicket.submittedby === user.id ||
        existingTicket.client === user.organizationId;

      if (!canUpdate) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You don't have permission to update this ticket",
        });
        return;
      }
    }
    // Super admin can update all tickets

    // Prepare update data
    const updatePayload: any = {
      updatedAt: new Date(),
    };

    // Map fields to schema
    if (updateData.subject) updatePayload.subject = updateData.subject;
    if (updateData.description)
      updatePayload.description = updateData.description;
    if (updateData.priority) updatePayload.priority = updateData.priority;
    if (updateData.status) updatePayload.status = updateData.status;
    if (updateData.assignedToUser)
      updatePayload.assignedto = updateData.assignedToUser;
    if (updateData.assignedToOrganization)
      updatePayload.client = updateData.assignedToOrganization;

    // Update the support ticket
    const [updatedTicket] = await database
      .update(supportTickets)
      .set(updatePayload)
      .where(eq(supportTickets.id, id))
      .returning();

    // Create notification for status changes
    if (updateData.status && updateData.status !== existingTicket.status) {
      try {
        // Notify the ticket submitter about status change
        if (existingTicket.submittedby !== user.id) {
          await database.insert(notifications).values({
            id: crypto.randomUUID(),
            userId: existingTicket.submittedby,
            type: "support_ticket_status_change",
            title: "Support Ticket Status Updated",
            message: `Your support ticket ${existingTicket.ticketNumber} status has been changed to ${updateData.status}`,
            data: {
              ticketId: existingTicket.id,
              ticketNumber: existingTicket.ticketNumber,
              oldStatus: existingTicket.status,
              newStatus: updateData.status,
              updatedBy: user.name || "System",
            },
            read: false,
            createdAt: new Date(),
          });
        }

        // If assigned to a specific user, notify them
        if (
          existingTicket.assignedto &&
          existingTicket.assignedto !== user.id
        ) {
          await database.insert(notifications).values({
            id: crypto.randomUUID(),
            userId: existingTicket.assignedto,
            type: "support_ticket_status_change",
            title: "Assigned Support Ticket Status Updated",
            message: `Support ticket ${existingTicket.ticketNumber} status has been changed to ${updateData.status}`,
            data: {
              ticketId: existingTicket.id,
              ticketNumber: existingTicket.ticketNumber,
              oldStatus: existingTicket.status,
              newStatus: updateData.status,
              updatedBy: user.name || "System",
            },
            read: false,
            createdAt: new Date(),
          });
        }
      } catch (notificationError) {
        logger.error(
          "Error creating status change notification:",
          notificationError
        );
        // Don't fail the update if notification fails
      }
    }

    // Create notification for assignment changes
    if (
      updateData.assignedToUser &&
      updateData.assignedToUser !== existingTicket.assignedto
    ) {
      try {
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: updateData.assignedToUser,
          type: "support_ticket_assigned",
          title: "Support Ticket Assigned to You",
          message: `You have been assigned support ticket ${existingTicket.ticketNumber}: ${existingTicket.subject}`,
          data: {
            ticketId: existingTicket.id,
            ticketNumber: existingTicket.ticketNumber,
            priority: existingTicket.priority,
            assignedBy: user.name || "System",
          },
          read: false,
          createdAt: new Date(),
        });
      } catch (notificationError) {
        logger.error(
          "Error creating assignment notification:",
          notificationError
        );
        // Don't fail the update if notification fails
      }
    }

    logger.info(
      `Support ticket ${existingTicket.ticketNumber} updated by user ${user.id}`
    );

    // Log activity (best-effort)
    try {
      const organizationId = (req.user as any)?.organizationId as
        | string
        | undefined;
      if (organizationId && user.id) {
        const changedFields = Object.keys(updatePayload).filter(
          (k) => k !== "updatedAt"
        );
        await logActivity({
          organizationId,
          actorId: user.id,
          userId: existingTicket.submittedby,
          type: "support_ticket",
          action: "update",
          resource: "support_ticket",
          resourceId: existingTicket.id,
          message: `Updated support ticket: ${existingTicket.ticketNumber}`,
          metadata: { changedFields, status: updateData.status },
        });
      }
    } catch (e) {
      logger.error("Failed to log activity for support ticket update", e);
    }

    res.status(status.OK).json({
      success: true,
      message: "Support ticket updated successfully",
      data: updatedTicket,
    });
  } catch (error) {
    logger.error("Error updating support ticket:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
