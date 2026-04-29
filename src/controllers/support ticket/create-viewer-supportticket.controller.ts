import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and, or, desc } from "drizzle-orm";
import {
  supportTickets,
  users,
  notifications,
  userOrganizations,
} from "@/schema/schema";
import { z } from "zod";
import status from "http-status";
import crypto from "crypto";

// Helper function to create support ticket notifications for viewers
const createViewerSupportTicketNotifications = async (
  ticket: any,
  creator: any,
  assignedToUser?: string,
) => {
  try {
    const notificationPromises = [];

    // If assigned to a specific user, notify that user
    if (assignedToUser) {
      notificationPromises.push(
        database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: assignedToUser,
          type: "support_ticket_assigned",
          title: "New Support Ticket Assigned",
          message: `You have been assigned a new support ticket: ${ticket.subject}`,
          data: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            priority: ticket.priority,
            submittedBy: creator.name || "Unknown User",
          },
          read: false,
          createdAt: new Date(),
        }),
      );
    }

    // Notify all users in the creator's organization (except the creator)
    if (creator.organizationId) {
      const orgUsers = await database.query.userOrganizations.findMany({
        where: eq(userOrganizations.organizationId, creator.organizationId),
        with: {
          user: {
            columns: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      for (const orgUser of orgUsers) {
        // Don't notify the creator
        if (orgUser.userId !== creator.id) {
          notificationPromises.push(
            database.insert(notifications).values({
              id: crypto.randomUUID(),
              userId: orgUser.userId,
              organizationId: creator.organizationId,
              type: "support_ticket_created",
              title: "New Support Ticket Created",
              message: `A new support ticket has been created: ${ticket.subject}`,
              data: {
                ticketId: ticket.id,
                ticketNumber: ticket.ticketNumber,
                priority: ticket.priority,
                submittedBy: creator.name || "Unknown User",
              },
              read: false,
              createdAt: new Date(),
            }),
          );
        }
      }
    }

    // Execute all notification inserts
    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises);
      logger.info(
        `Created ${notificationPromises.length} notifications for viewer support ticket ${ticket.ticketNumber}`,
      );
    }
  } catch (error) {
    logger.error("Error creating viewer support ticket notifications:", error);
    // Don't throw error to avoid breaking ticket creation
  }
};

// Validation schema for creating viewer support tickets
const createViewerSupportTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .transform((val) => val.toLowerCase())
    .default("medium"),
  client: z.string().optional(),
  assignedToUser: z.string().optional(), // Only specific user assignment allowed
  destination: z.enum(["internal", "platform"]).default("internal"),
});

export const createViewerSupportTicket = async (
  req: any,
  res: Response,
): Promise<void> => {
  const user = req.user;

  try {
    logger.info("=== CREATE VIEWER SUPPORT TICKET DEBUG ===");
    logger.info("Request body:", JSON.stringify(req.body, null, 2));

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

    logger.info("User:", JSON.stringify(user, null, 2));
    logger.info(
      `Creating viewer ticket for user ID: ${user.id}, role: ${user.role}`,
    );

    // Validate request body
    logger.info("About to validate request body...");
    const validationResult = createViewerSupportTicketSchema.safeParse(
      req.body,
    );
    if (!validationResult.success) {
      logger.error("Validation failed:", validationResult.error.errors);
      logger.error("Request body:", req.body);
      logger.error(
        "Validation error details:",
        JSON.stringify(validationResult.error, null, 2),
      );
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.error.errors,
      });
      return;
    }
    logger.info("Validation passed successfully");

    const {
      subject,
      description,
      priority,
      client,
      assignedToUser,
      destination,
    } = validationResult.data;

    // Viewers can only assign to users in their organization
    if (assignedToUser) {
      // Check if the assigned user is in the viewer's organization
      const assignedUserOrg = await database.query.userOrganizations.findFirst({
        where: eq(userOrganizations.userId, assignedToUser),
        columns: {
          organizationId: true,
        },
      });

      if (
        !assignedUserOrg ||
        assignedUserOrg.organizationId !== user.organizationId
      ) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You can only assign tickets to users in your organization",
        });
        return;
      }
    }

    // Generate ticket number
    const randomSixDigitNumber = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `VWR-${randomSixDigitNumber}`; // Prefix for viewer tickets

    // Determine client routing
    let finalClient = client || user.organizationId || "General";
    if (destination === "internal" && user.organizationId) {
      finalClient = user.organizationId;
    } else if (destination === "platform") {
      finalClient = "Platform";
    }

    // Debug: Log assignment values
    logger.info("Assignment debug:", {
      assignedToUser,
      destination,
      finalAssignedTo: assignedToUser || "Unassigned",
      finalClient,
    });

    // Create support ticket
    const [newTicket] = await database
      .insert(supportTickets)
      .values({
        ticketNumber,
        subject,
        description,
        priority: priority as "low" | "medium" | "high" | "urgent",
        status: "open" as "open" | "in_progress" | "resolved" | "closed",
        submittedby: user.id,
        submittedbyName: user.name || "Unknown User",
        submittedbyRole: user.role,
        destination,
        client: finalClient,
        assignedto: assignedToUser || "Unassigned",
        createdon: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Get creator details for notifications
    const creator = await database.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: {
        id: true,
        name: true,
        email: true,
      },
    });

    // Create notifications
    await createViewerSupportTicketNotifications(
      newTicket,
      creator,
      assignedToUser,
    );

    logger.info(
      `Viewer support ticket created: ${ticketNumber} by user ${user.id}`,
    );

    res.status(status.CREATED).json({
      success: true,
      message: "Viewer support ticket created successfully",
      data: newTicket,
    });
  } catch (error) {
    logger.error("Error creating viewer support ticket:", error);
    logger.error("Request body:", req.body);
    logger.error("User:", user);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create viewer support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get viewer support tickets (only tickets assigned to the viewer)
export const getViewerSupportTickets = async (
  req: any,
  res: Response,
): Promise<void> => {
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

    const {
      status: ticketStatus,
      priority,
      limit = "50",
      offset = "0",
    } = req.query;

    logger.info("Fetching viewer support tickets:", {
      userId: user.id,
      userRole: user.role,
      organizationId: user.organizationId,
      filters: { ticketStatus, priority },
    });

    // Get viewer's organization ID
    let organizationId = user.organizationId;
    if (!organizationId) {
      // Fallback: fetch from userOrganizations mapping table
      const userOrg = await database
        .select({ organizationId: userOrganizations.organizationId })
        .from(userOrganizations)
        .where(eq(userOrganizations.userId, user.id))
        .limit(1);

      if (userOrg.length && userOrg[0].organizationId) {
        organizationId = userOrg[0].organizationId;
      }
    }

    logger.info("Viewer organization resolved:", {
      userId: user.id,
      organizationId,
      fromUser: !!user.organizationId,
      fromUserOrg: !user.organizationId && !!organizationId,
    });

    // Viewers can see tickets:
    // 1. Assigned directly to them (assignedto === user.id)
    // 2. Assigned to their organization (assignedto === organizationId)
    // 3. Where client field matches their organization (for backwards compatibility)
    const assignmentConditions = [eq(supportTickets.assignedto, user.id)];

    if (organizationId) {
      // Also include tickets assigned to the viewer's organization
      assignmentConditions.push(eq(supportTickets.assignedto, organizationId));
      // Also check if client field matches organization (some tickets may use client field for assignment)
      assignmentConditions.push(eq(supportTickets.client, organizationId));
    }

    // Combine assignment conditions with OR logic - viewer should see tickets matching any of these conditions
    const assignmentCondition =
      assignmentConditions.length > 1
        ? or(...assignmentConditions)
        : assignmentConditions[0];

    // Build final where conditions: assignment (OR) AND status (if specified) AND priority (if specified)
    const finalConditions = [assignmentCondition];

    // Apply additional filters
    if (ticketStatus) {
      finalConditions.push(
        eq(supportTickets.status, ticketStatus as "open" | "closed"),
      );
    }
    if (priority) {
      finalConditions.push(
        eq(
          supportTickets.priority,
          priority as "low" | "medium" | "high" | "urgent",
        ),
      );
    }

    logger.info("Query conditions for viewer tickets:", {
      userId: user.id,
      organizationId,
      assignmentConditionsCount: assignmentConditions.length,
      finalConditionsCount: finalConditions.length,
      ticketStatus,
      priority,
    });

    const tickets = await database.query.supportTickets.findMany({
      where:
        finalConditions.length > 0
          ? and(...finalConditions)
          : assignmentCondition,
      orderBy: [desc(supportTickets.createdon)],
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });

    logger.info(
      `Found ${tickets.length} tickets for viewer ${user.id} (directly assigned or to organization ${organizationId})`,
    );

    // Log ticket details for debugging
    if (tickets.length > 0) {
      logger.info(
        "Tickets assigned to viewer:",
        tickets.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          subject: t.subject,
          assignedto: t.assignedto,
          submittedby: t.submittedby,
          status: t.status,
        })),
      );
    } else {
      logger.info(
        "No tickets found assigned to viewer. Checking if there are any tickets in the system...",
      );
      const allTickets = await database.query.supportTickets.findMany({
        limit: 5,
        orderBy: [desc(supportTickets.createdon)],
      });
      logger.info(
        "Sample tickets in system:",
        allTickets.map((t) => ({
          id: t.id,
          ticketNumber: t.ticketNumber,
          assignedto: t.assignedto,
          submittedby: t.submittedby,
          status: t.status,
        })),
      );
    }

    res.status(status.OK).json({
      success: true,
      message: "Viewer support tickets fetched successfully",
      data: {
        tickets,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          total: tickets.length,
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching viewer support tickets:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while fetching viewer support tickets",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
