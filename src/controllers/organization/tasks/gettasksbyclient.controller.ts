import { database } from "@/configs/connection.config";
import { tasks, projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import status from "http-status";

/**
 * Get all tasks for a specific client
 * Accepts organizationId in request body and clientId in params
 */
export const getTasksByClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { clientId } = req.params;
    const { organizationId } = req.body; // Get organizationId from request body

    // Validate inputs
    if (!clientId) {
      logger.error("❌ Client ID is required");
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Client ID is required in params",
      });
      return;
    }

    // Validate organizationId from body
    if (!organizationId) {
      logger.error("❌ Organization ID is required in request body");
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required in request body",
      });
      return;
    }

    logger.info(
      `🔍 Fetching tasks for clientId: ${clientId}, organizationId: ${organizationId}`,
    );

    // Step 1: Verify that the clientId belongs to the specified organization
    const clientData = await database
      .select({
        id: clients.id,
        organizationId: clients.organizationId,
        name: clients.name,
      })
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId),
        ),
      )
      .limit(1);

    // Verify client exists and belongs to the specified organization
    if (clientData.length === 0) {
      logger.warn(
        `⚠️ Client with ID ${clientId} not found in organization ${organizationId}`,
      );
      res.status(status.FORBIDDEN).json({
        success: false,
        message:
          "Client not found or does not belong to the specified organization",
      });
      return;
    }

    const clientInfo = clientData[0];
    logger.info(`✅ Client verified: ${clientInfo.name}`);

    // Step 2: Fetch all tasks for this client (joining with projects)
    const tasksData = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        endDate: tasks.endDate,
        startDate: tasks.startDate,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        attachments: tasks.attachments,
        parentId: tasks.parentId,
        startAfter: tasks.startAfter,
        finishBefore: tasks.finishBefore,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Project data
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        // Assignee data
        assigneeId: users.id,
        assigneeName: users.name,
        assigneeEmail: users.email,
        assigneeImage: users.image,
        // Creator data
        creatorId: users.id,
        creatorName: users.name,
        // Client data
        clientId: clients.id,
        clientName: clients.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assignedTo, users.id))
      // Join clients to get client details, but primarily to filter
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(projects.clientId, clientId),
          eq(projects.organizationId, organizationId),
        ),
      )
      .orderBy(desc(tasks.createdAt));

    logger.info(
      `✅ Found ${tasksData.length} tasks for client ${clientInfo.name}`,
    );

    res.status(status.OK).json({
      success: true,
      message: `Tasks fetched successfully for client: ${clientInfo.name}`,
      data: {
        clientId: clientId,
        clientName: clientInfo.name,
        taskCount: tasksData.length,
        tasks: tasksData,
      },
    });
  } catch (error) {
    logger.error("Error fetching tasks by client:", error);
    console.error("Full error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
