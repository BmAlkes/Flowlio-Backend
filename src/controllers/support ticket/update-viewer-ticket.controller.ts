import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and, or } from "drizzle-orm";
import { supportTickets } from "../../schema/schema";
import status from "http-status";
import { z } from "zod";

const updateViewerSupportTicketSchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
});

export const updateViewerSupportTicket = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { id: ticketId } = req.params;
  const user = req.user;

  try {
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Only viewers can use this endpoint
    if (user.role !== "viewer") {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "This endpoint is only for viewers",
      });
      return;
    }

    // Validate request body
    const validationResult = updateViewerSupportTicketSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.error.errors,
      });
      return;
    }

    const { status: ticketStatus, priority } = validationResult.data;

    // Viewers can only update tickets assigned to them or their organization
    // Check if the ticket exists and matches viewer's assignment
    const ticket = await database.query.supportTickets.findFirst({
      where: and(
        eq(supportTickets.id, ticketId),
        or(
          eq(supportTickets.assignedto, user.id),
          eq(supportTickets.assignedto, user.organizationId || ""),
          eq(supportTickets.client, user.organizationId || "")
        )
      ),
    });

    if (!ticket) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Ticket not found or you don't have permission to update it",
      });
      return;
    }

    // Prepare update data
    const updateData: any = {
      updatedAt: new Date(),
    };
    if (ticketStatus) updateData.status = ticketStatus;
    if (priority) updateData.priority = priority;

    // Perform update
    const [updatedTicket] = await database
      .update(supportTickets)
      .set(updateData)
      .where(eq(supportTickets.id, ticketId))
      .returning();

    res.status(status.OK).json({
      success: true,
      message: "Ticket updated successfully",
      data: updatedTicket,
    });
  } catch (error) {
    logger.error("Error updating viewer support ticket:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to update viewer support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
