import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { supportTickets } from "@/schema/schema";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

export const deleteSupportTicket = async (
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

    // Get the existing ticket
    const existingTicket = await database.query.supportTickets.findFirst({
      where: eq(supportTickets.id, id),
      columns: {
        id: true,
        ticketNumber: true,
        submittedby: true,
        client: true,
        status: true,
      },
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
        message: "You don't have permission to delete this ticket",
      });
      return;
    }

    if (user.role === "subadmin") {
      // Subadmin can delete tickets they submitted or tickets from their organization
      const canDelete =
        existingTicket.submittedby === user.id ||
        existingTicket.client === user.organizationId;

      if (!canDelete) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You don't have permission to delete this ticket",
        });
        return;
      }
    }
    // Super admin can delete all tickets

    // Only allow deletion of open or in_progress tickets
    if (existingTicket.status === "closed") {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Cannot delete resolved or closed tickets",
      });
      return;
    }

    // Log activity (best-effort) before deletion
    try {
      const organizationId = (req.user as any)?.organizationId as string | undefined;
      if (organizationId && user.id) {
        await logActivity({
          organizationId,
          actorId: user.id,
          userId: existingTicket.submittedby,
          type: "support_ticket",
          action: "delete",
          resource: "support_ticket",
          resourceId: existingTicket.id,
          message: `Deleted support ticket: ${existingTicket.ticketNumber}`,
        });
      }
    } catch (e) {
      logger.error("Failed to log activity for support ticket deletion", e);
    }

    // Delete the support ticket
    await database.delete(supportTickets).where(eq(supportTickets.id, id));

    logger.info(
      `Support ticket ${existingTicket.ticketNumber} deleted by user ${user.id}`
    );

    res.status(status.OK).json({
      success: true,
      message: "Support ticket deleted successfully",
      data: {
        id: existingTicket.id,
        ticketNumber: existingTicket.ticketNumber,
      },
    });
  } catch (error) {
    logger.error("Error deleting support ticket:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
