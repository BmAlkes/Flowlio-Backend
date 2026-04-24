import { database } from "@/configs/connection.config";
import { projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import status from "http-status";

/**
 * Get all projects for a specific client
 * Accepts organizationId in request body and clientId in params
 */
export const getProjectsByClient = async (
  req: Request,
  res: Response
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

    logger.info(`🔍 Fetching projects for clientId: ${clientId}, organizationId: ${organizationId}`);

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
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    // Verify client exists and belongs to the specified organization
    if (clientData.length === 0) {
      logger.warn(
        `⚠️ Client with ID ${clientId} not found in organization ${organizationId}`
      );
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "Client not found or does not belong to the specified organization",
      });
      return;
    }

    const clientInfo = clientData[0];
    logger.info(`✅ Client verified: ${clientInfo.name}`);

    // Step 2: Fetch all projects for this client
    const assignedUsers = alias(users, "assigned_users");
    const createdByUsers = alias(users, "created_by_users");

    const projectsData = await database
      .select({
        id: projects.id,
        projectNumber: projects.projectNumber,
        name: projects.name,
        description: projects.description,
        startDate: projects.startDate,
        endDate: projects.endDate,
        assignedTo: projects.assignedTo,
        status: projects.status,
        progress: projects.progress,
        address: projects.address,
        budget: projects.budget,
        contractfile: projects.contractfile,
        contractfilePublicId: projects.contractfilePublicId,
        projectFiles: projects.projectFiles,
        createdBy: projects.createdBy,
        organizationId: projects.organizationId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        clientId: projects.clientId,
        tags: projects.tags,
        customFields: projects.customFields,
        // Client information
        clientName: clients.name,
        clientEmail: clients.email,
        // Assigned user information
        assignedUserName: assignedUsers.name,
        assignedUserEmail: assignedUsers.email,
        // Created by user information
        createdByName: createdByUsers.name,
        createdByEmail: createdByUsers.email,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(assignedUsers, eq(projects.assignedTo, assignedUsers.id))
      .leftJoin(createdByUsers, eq(projects.createdBy, createdByUsers.id))
      .where(
        and(
          eq(projects.clientId, clientId),
          eq(projects.organizationId, organizationId)
        )
      )
      .orderBy(desc(projects.createdAt));

    logger.info(
      `✅ Found ${projectsData.length} projects for client ${clientInfo.name}`
    );

    // Transform the data to match frontend expectations
    const transformedProjects = projectsData.map((project) => ({
      id: project.id,
      projectNumber: project.projectNumber,
      projectName: project.name,
      clientName: project.clientName || "Unknown Client",
      clientId: project.clientId,
      description: project.description || "",
      startDate: project.startDate ? new Date(project.startDate) : null,
      endDate: project.endDate ? new Date(project.endDate) : null,
      assignedProject: project.assignedUserName || "Unassigned",
      address: project.address || "",
      budget: project.budget,
      status: project.status || "pending",
      progress: project.progress || 0,
      createdBy: project.createdByName || "Unknown",
      organizationId: project.organizationId,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      // Additional fields for frontend
      assignedTo: project.assignedTo,
      contractfile: project.contractfile,
      contractfilePublicId: project.contractfilePublicId,
      projectFiles: project.projectFiles,
      tags: project.tags,
      customFields: project.customFields,
    }));

    res.status(status.OK).json({
      success: true,
      message: `Projects fetched successfully for client: ${clientInfo.name}`,
      data: {
        clientId: clientId,
        clientName: clientInfo.name,
        projectCount: transformedProjects.length,
        projects: transformedProjects,
      },
    });
  } catch (error) {
    logger.error("Error fetching projects by client:", error);
    console.error("Full error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error"
    });
  }
};