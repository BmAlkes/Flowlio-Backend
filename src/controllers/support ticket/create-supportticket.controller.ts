import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import {
  supportTickets,
  users,
  notifications,
  userOrganizations,
} from "../../../drizzle/schema";
import { z } from "zod";
import status from "http-status";
import crypto from "crypto";
import { logActivity } from "@/utils/activity.util";

// Helper function to create support ticket notifications
const createSupportTicketNotifications = async (
  ticket: any,
  creator: any,
  assignedToOrganization?: string,
  assignedToUser?: string
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
          createdAt: new Date().toISOString(),
        })
      );
    }

    // If assigned to an organization, notify all users in that organization
    if (assignedToOrganization) {
      const orgUsers = await database.query.userOrganizations.findMany({
        where: eq(userOrganizations.organizationId, assignedToOrganization),
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
              organizationId: assignedToOrganization,
              type: "support_ticket_organization",
              title: "New Support Ticket in Organization",
              message: `A new support ticket has been created in your organization: ${ticket.subject}`,
              data: {
                ticketId: ticket.id,
                ticketNumber: ticket.ticketNumber,
                priority: ticket.priority,
                submittedBy: creator.name || "Unknown User",
              },
              read: false,
              createdAt: new Date().toISOString(),
            })
          );
        }
      }
    }

    // If no specific assignment, notify all users in the creator's organization
    if (!assignedToUser && !assignedToOrganization && creator.organizationId) {
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
              createdAt: new Date().toISOString(),
            })
          );
        }
      }
    }

    // Execute all notification inserts
    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises);
      logger.info(
        `Created ${notificationPromises.length} notifications for support ticket ${ticket.ticketNumber}`
      );
    }
  } catch (error) {
    logger.error("Error creating support ticket notifications:", error);
    // Don't throw error to avoid breaking ticket creation
  }
};

// Validation schema for creating support tickets
const createSupportTicketSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  description: z.string().min(1, "Description is required"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .transform((val) => val.toLowerCase())
    .default("medium"),
  client: z.string().optional(),
  assignedToOrganization: z.string().optional(),
  assignedToUser: z.string().optional(),
});

export const createSupportTicket = async (
  req: Request,
  res: Response
): Promise<void> => {
  const user = req.user;

  try {
    logger.info("=== CREATE SUPPORT TICKET DEBUG ===");
    logger.info("Request body:", JSON.stringify(req.body, null, 2));
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    logger.info("User:", JSON.stringify(user, null, 2));
    logger.info(`Creating ticket for user ID: ${user.id}, role: ${user.role}`);

    // Validate request body
    logger.info("About to validate request body...");
    const validationResult = createSupportTicketSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.error("Validation failed:", validationResult.error.errors);
      logger.error("Request body:", req.body);
      logger.error(
        "Validation error details:",
        JSON.stringify(validationResult.error, null, 2)
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
      assignedToOrganization,
      assignedToUser,
    } = validationResult.data;

    // Role-based permission validation
    if (user.role === "user") {
      // Regular users can create tickets for users in their organization
      if (assignedToUser) {
        // Check if the assigned user is in the same organization as the creator
        const assignedUserOrg =
          await database.query.userOrganizations.findFirst({
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
            message:
              "You can only assign tickets to users in your organization",
          });
          return;
        }
      }

      if (assignedToOrganization) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You cannot assign tickets to organizations",
        });
        return;
      }
    } else if (user.role === "subadmin") {
      // Sub admins can only create tickets for users in their organization
      if (assignedToUser) {
        // Check if the assigned user is in the subadmin's organization
        const assignedUserOrg =
          await database.query.userOrganizations.findFirst({
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
            message:
              "You can only assign tickets to users in your organization",
          });
          return;
        }
      }

      if (
        assignedToOrganization &&
        assignedToOrganization !== user.organizationId
      ) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You can only assign tickets to your own organization",
        });
        return;
      }
    }
    // Super admin has no restrictions - can assign to anyone

    // Generate ticket number
    const randomSixDigitNumber = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `TKT-${randomSixDigitNumber}`;

    // Debug: Log assignment values
    logger.info("Assignment debug:", {
      assignedToUser,
      assignedToOrganization,
      client,
      finalAssignedTo: assignedToUser || assignedToOrganization || "Unassigned",
      finalClient:
        client || assignedToOrganization || assignedToUser || "General",
    });

    // Create support ticket
    const [newTicket] = await database
      .insert(supportTickets)
      .values({
        ticketNumber,
        subject,
        description,
        priority,
        status: "open",
        submittedby: user.id,
        submittedbyName: user.name || "Unknown User",
        submittedbyRole: user.role,
        client: client || assignedToOrganization || assignedToUser || "General",
        assignedto: assignedToUser || assignedToOrganization || "Unassigned",
        createdon: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
    await createSupportTicketNotifications(
      newTicket,
      creator,
      assignedToOrganization,
      assignedToUser
    );

    // Log activity (best-effort)
    try {
      const organizationId = (req.user as any)?.organizationId as
        | string
        | undefined;
      if (organizationId && user.id) {
        await logActivity({
          organizationId,
          actorId: user.id,
          userId: assignedToUser || undefined,
          type: "support_ticket",
          action: "create",
          resource: "support_ticket",
          resourceId: newTicket.id,
          message: `Created support ticket: ${ticketNumber}`,
          metadata: { priority, subject },
        });
      }
    } catch (e) {
      logger.error("Failed to log activity for support ticket creation", e);
    }

    logger.info(`Support ticket created: ${ticketNumber} by user ${user.id}`);

    res.status(status.CREATED).json({
      success: true,
      message: "Support ticket created successfully",
      data: newTicket,
    });
  } catch (error) {
    logger.error("Error creating support ticket:", error);
    logger.error("Request body:", req.body);
    logger.error("User:", user);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
