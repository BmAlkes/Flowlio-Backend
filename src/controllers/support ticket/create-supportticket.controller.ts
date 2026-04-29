import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and, or } from "drizzle-orm";
import {
  supportTickets,
  users,
  notifications,
  userOrganizations,
} from "@/schema/schema";
import { z } from "zod";
import status from "http-status";
import crypto from "crypto";
import { logActivity } from "@/utils/activity.util";

// Helper function to create support ticket notifications
const createSupportTicketNotifications = async (
  ticket: any,
  creator: any,
  assignedToOrganization?: string,
  assignedToUser?: string,
) => {
  try {
    const notificationPromises = [];

    // If it's an internal ticket, notify organization admins/managers
    if (ticket.destination === "internal" && creator.organizationId) {
      const orgAdmins = await database.query.userOrganizations.findMany({
        where: and(
          eq(userOrganizations.organizationId, creator.organizationId),
          or(
            eq(userOrganizations.role, "admin"),
            eq(userOrganizations.role, "manager"),
            eq(userOrganizations.role, "subadmin"),
          ),
        ),
        with: {
          user: true,
        },
      });

      for (const orgAdmin of orgAdmins) {
        if (orgAdmin.userId !== creator.id) {
          notificationPromises.push(
            database.insert(notifications).values({
              id: crypto.randomUUID(),
              userId: orgAdmin.userId,
              organizationId: creator.organizationId,
              type: "internal_support_ticket",
              title: "New Internal Support Request",
              message: `A member of your organization submitted an internal support ticket: ${ticket.subject}`,
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

    // If it's a platform ticket, notify super admins (if no specific assignment)
    if (
      ticket.destination === "platform" &&
      !assignedToUser &&
      !assignedToOrganization
    ) {
      const superAdmins = await database.query.users.findMany({
        where: eq(users.role, "superadmin"),
      });

      for (const admin of superAdmins) {
        if (admin.id !== creator.id) {
          notificationPromises.push(
            database.insert(notifications).values({
              id: crypto.randomUUID(),
              userId: admin.id,
              type: "platform_support_ticket",
              title: "New Platform Support Ticket",
              message: `A new platform support ticket has been submitted: ${ticket.subject}`,
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

    // Original notification logic for explicit assignments
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
              createdAt: new Date(),
            }),
          );
        }
      }
    }

    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises);
      logger.info(
        `Created ${notificationPromises.length} notifications for support ticket ${ticket.ticketNumber}`,
      );
    }
  } catch (error) {
    logger.error("Error creating support ticket notifications:", error);
  }
};

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
  destination: z.enum(["internal", "platform"]).default("platform"),
});

export const createSupportTicket = async (
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

    const validationResult = createSupportTicketSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.error.errors,
      });
      return;
    }

    const {
      subject,
      description,
      priority,
      client,
      assignedToOrganization,
      assignedToUser,
      destination,
    } = validationResult.data;

    // Permissions check
    if (user.role === "user") {
      if (assignedToUser) {
        const assignedUserOrg =
          await database.query.userOrganizations.findFirst({
            where: eq(userOrganizations.userId, assignedToUser),
            columns: { organizationId: true },
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
    }

    const randomSixDigitNumber = Math.floor(100000 + Math.random() * 900000);
    const ticketNumber = `TKT-${randomSixDigitNumber}`;

    let finalClient =
      client || assignedToOrganization || assignedToUser || "General";
    if (destination === "internal" && user.organizationId) {
      finalClient = user.organizationId;
    } else if (destination === "platform") {
      finalClient = "Platform";
    }

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
        assignedto: assignedToUser || assignedToOrganization || "Unassigned",
        createdon: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const creator = await database.query.users.findFirst({
      where: eq(users.id, user.id),
      columns: { id: true, name: true, email: true },
    });

    await createSupportTicketNotifications(
      newTicket,
      creator,
      assignedToOrganization,
      assignedToUser,
    );

    try {
      const organizationId = (req.user as any)?.organizationId;
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
      logger.error("Failed to log activity", e);
    }

    res.status(status.CREATED).json({
      success: true,
      message: "Support ticket created successfully",
      data: newTicket,
    });
  } catch (error) {
    logger.error("Error creating support ticket:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
