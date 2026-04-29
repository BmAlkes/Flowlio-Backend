import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and, or, desc, like, sql } from "drizzle-orm";
import { supportTickets } from "@/schema/schema";
import { z } from "zod";
import status from "http-status";

// Validation schema for query parameters
const getSupportTicketsSchema = z.object({
  page: z.string().optional().default("1"),
  limit: z.string().optional().default("10"),
  status: z.enum(["open", "in_progress", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  search: z.string().optional(),
});

export const getSupportTickets = async (
  req: any,
  res: Response,
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

    const validationResult = getSupportTicketsSchema.safeParse(req.query);
    if (!validationResult.success) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Invalid query parameters",
        errors: validationResult.error.errors,
      });
      return;
    }

    const {
      page,
      limit,
      status: ticketStatus,
      priority,
      search,
    } = validationResult.data;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions: any[] = [];

    // Filter by role and destination
    if (user.role === "superadmin") {
      // Superadmin can see everything
      whereConditions = [];
    } else if (user.role === "subadmin") {
      // Subadmin (org admin) can see:
      // 1. All internal tickets in their organization
      // 2. Platform tickets they submitted
      whereConditions = [
        or(
          and(
            eq(supportTickets.destination, "internal"),
            eq(supportTickets.client, user.organizationId || "General"),
          ),
          and(
            eq(supportTickets.destination, "platform"),
            eq(supportTickets.submittedby, user.id),
          ),
          eq(supportTickets.assignedto, user.id),
        ),
      ];
    } else {
      // Regular user/viewer can see:
      // 1. All internal tickets in their organization
      // 2. Platform tickets they submitted
      whereConditions = [
        or(
          and(
            eq(supportTickets.destination, "internal"),
            eq(supportTickets.client, user.organizationId || "General"),
          ),
          and(
            eq(supportTickets.destination, "platform"),
            eq(supportTickets.submittedby, user.id),
          ),
          eq(supportTickets.assignedto, user.id),
        ),
      ];
    }

    // Apply additional filters
    if (ticketStatus) {
      whereConditions.push(eq(supportTickets.status, ticketStatus));
    }
    if (priority) {
      whereConditions.push(eq(supportTickets.priority, priority));
    }
    if (search) {
      whereConditions.push(
        or(
          like(supportTickets.subject, `%${search}%`),
          like(supportTickets.ticketNumber, `%${search}%`),
        ),
      );
    }

    const tickets = await database.query.supportTickets.findMany({
      where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
      orderBy: [desc(supportTickets.createdon)],
      limit: parseInt(limit),
      offset: offset,
    });

    const [countResult] = await database
      .select({ count: sql<number>`count(*)` })
      .from(supportTickets)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    res.status(status.OK).json({
      success: true,
      data: {
        tickets,
        pagination: {
          total: Number(countResult.count),
          page: parseInt(page),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    logger.error("Error getting support tickets:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to get support tickets",
      error: error instanceof Error ? error.stack || error.message : "Unknown error",
    });
  }
};

// Get a single support ticket by ID
export const getSupportTicketById = async (
  req: any,
  res: Response,
): Promise<void> => {
  try {
    const user = req.user;
    const { id } = req.params;

    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const ticket = await database.query.supportTickets.findFirst({
      where: eq(supportTickets.id, id),
    });

    if (!ticket) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Support ticket not found",
      });
      return;
    }

    // Permission check
    let hasPermission = false;
    if (user.role === "superadmin") {
      hasPermission = true;
    } else if (ticket.destination === "internal") {
      // Internal tickets are visible to anyone in the same organization
      hasPermission = ticket.client === user.organizationId;
    } else {
      // Platform tickets are only visible to the submitter (and superadmin, handled above)
      hasPermission = ticket.submittedby === user.id;
    }

    if (!hasPermission) {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "You don't have permission to view this ticket",
      });
      return;
    }

    res.status(status.OK).json({
      success: true,
      data: ticket,
    });
  } catch (error) {
    logger.error("Error getting support ticket by ID:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to get support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
