import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, and, or, desc, like } from "drizzle-orm";
import { supportTickets, users, organizations } from "../../../drizzle/schema";
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

    // Validate query parameters
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
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    // Build where conditions based on user role
    let whereConditions: any[] = [];

    logger.info(`User role: ${user.role}, User ID: ${user.id}`);

    if (user.role === "superadmin") {
      // Superadmin can see all tickets
      whereConditions = [];
      logger.info("Superadmin - no filters applied");
    } else if (user.role === "subadmin") {
      // Subadmin can see tickets from their organization and tickets they submitted
      whereConditions = [
        or(
          eq(supportTickets.client, user.organizationId || "General"),
          eq(supportTickets.submittedby, user.id)
        ),
      ];
      logger.info(
        `Subadmin - filtering by client: ${user.organizationId} or submittedby: ${user.id}`
      );
    } else {
      // Regular users can see their own tickets AND tickets assigned to their organization
      // Also check if the user is assigned to the ticket (assignedto field)
      // For client field, we need to check both organization ID and organization name
      whereConditions = [
        or(
          eq(supportTickets.submittedby, user.id),
          eq(supportTickets.client, user.organizationId || "General"),
          eq(supportTickets.assignedto, user.id),
          // Also check if assignedto is the user's organization ID
          eq(supportTickets.assignedto, user.organizationId || "General")
        ),
      ];
      logger.info(
        `Regular user - filtering by submittedby: ${user.id} OR client: ${user.organizationId} OR assignedto: ${user.id} OR assignedto: ${user.organizationId}`
      );
    }

    // Add status filter
    if (ticketStatus) {
      whereConditions.push(eq(supportTickets.status, ticketStatus));
    }

    // Add priority filter
    if (priority) {
      whereConditions.push(eq(supportTickets.priority, priority));
    }

    // Add search filter
    if (search) {
      whereConditions.push(
        or(
          like(supportTickets.subject, `%${search}%`),
          like(supportTickets.description, `%${search}%`),
          like(supportTickets.ticketNumber, `%${search}%`)
        )
      );
    }

    // Debug: Check all tickets in database first
    const allTickets = await database.query.supportTickets.findMany({
      columns: {
        id: true,
        ticketNumber: true,
        submittedby: true,
        client: true,
        assignedto: true,
        status: true,
      },
    });
    logger.info(`Total tickets in database: ${allTickets.length}`);
    if (allTickets.length > 0) {
      const ticket = allTickets[0];
      logger.info(`First ticket - ID: ${ticket.id}`);
      logger.info(`First ticket - Number: ${ticket.ticketNumber}`);
      logger.info(`First ticket - Submitted by: ${ticket.submittedby}`);
      logger.info(`First ticket - Client: ${ticket.client}`);
      logger.info(`First ticket - Assigned to: ${ticket.assignedto}`);
      logger.info(`First ticket - Status: ${ticket.status}`);
    }

    // Debug: Log the where conditions
    logger.info(`Where conditions length: ${whereConditions.length}`);
    whereConditions.forEach((condition, index) => {
      logger.info(`Where condition ${index}:`, condition);
    });

    // Get support tickets with pagination and user details
    const tickets = await database.query.supportTickets.findMany({
      where: whereConditions.length > 0 ? and(...whereConditions) : undefined,
      orderBy: [desc(supportTickets.createdon)],
      limit: limitNum,
      offset: offset,
      with: {
        submittedBy: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    logger.info(`Filtered tickets count: ${tickets.length}`);

    // Get assigned user details for each ticket
    const ticketsWithDetails = await Promise.all(
      tickets.map(async (ticket) => {
        let assignedUser = null;
        let assignedOrganization = null;

        // If assignedto is a user ID, get user details
        if (ticket.assignedto && ticket.assignedto !== "Unassigned") {
          logger.info(
            `Looking up assignment for ticket ${ticket.ticketNumber}: ${ticket.assignedto}`
          );

          // First try to find as a user
          assignedUser = await database.query.users.findFirst({
            where: eq(users.id, ticket.assignedto),
            columns: {
              id: true,
              name: true,
              email: true,
            },
          });

          if (assignedUser) {
            logger.info(
              `Found assigned user: ${assignedUser.name} (${assignedUser.email})`
            );
          } else {
            // If not found as user, try as organization
            assignedOrganization = await database.query.organizations.findFirst(
              {
                where: eq(organizations.id, ticket.assignedto),
                columns: {
                  id: true,
                  name: true,
                },
              }
            );

            if (assignedOrganization) {
              logger.info(
                `Found assigned organization: ${assignedOrganization.name}`
              );
            } else {
              logger.info(
                `No user or organization found for ID: ${ticket.assignedto}`
              );
            }
          }
        }

        // Get client organization details
        let clientOrganization = null;
        if (ticket.client && ticket.client !== "General") {
          try {
            clientOrganization = await database.query.organizations.findFirst({
              where: eq(organizations.id, ticket.client),
              columns: {
                id: true,
                name: true,
              },
            });
          } catch (error) {
            // Ignore errors, keep as is
          }
        }

        return {
          ...ticket,
          assignedUser,
          assignedOrganization,
          clientOrganization,
        };
      })
    );

    // Get total count for pagination
    const totalCount = await database
      .select({ count: supportTickets.id })
      .from(supportTickets)
      .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

    const totalTickets = totalCount.length;
    const totalPages = Math.ceil(totalTickets / limitNum);

    logger.info(
      `Retrieved ${tickets.length} support tickets for user ${user.id}`
    );

    // Debug: Log the first ticket to see the data structure
    if (ticketsWithDetails.length > 0) {
      logger.info(
        "First ticket data:",
        JSON.stringify(ticketsWithDetails[0], null, 2)
      );
    }

    res.status(status.OK).json({
      success: true,
      message: "Support tickets retrieved successfully",
      data: {
        tickets: ticketsWithDetails,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalTickets,
          limit: limitNum,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    logger.error("Error retrieving support tickets:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve support tickets",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Get a single support ticket by ID
export const getSupportTicketById = async (
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

    // Get the support ticket
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

    // Check if user has permission to view this ticket
    if (user.role === "user" && ticket.submittedby !== user.id) {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "You don't have permission to view this ticket",
      });
      return;
    }

    if (user.role === "subadmin") {
      // Subadmin can view tickets they submitted or tickets from their organization
      const canView =
        ticket.submittedby === user.id || ticket.client === user.organizationId;

      if (!canView) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You don't have permission to view this ticket",
        });
        return;
      }
    }
    // Super admin can view all tickets

    logger.info(
      `Retrieved support ticket ${ticket.ticketNumber} for user ${user.id}`
    );

    res.status(status.OK).json({
      success: true,
      message: "Support ticket retrieved successfully",
      data: ticket,
    });
  } catch (error) {
    logger.error("Error retrieving support ticket:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve support ticket",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
