import { database } from "@/configs/connection.config";
import { projects, clients, users, userOrganizations } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, desc, and, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import status from "http-status";

export const getAllProjects = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("🔍 getAllProjects called with user:", req.user);

    if (!req.user?.organizationId) {
      logger.error("❌ No organization ID found in request");
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user?.organizationId as string;
    logger.info("🏢 Organization ID:", organizationId);

    // Create aliases for users table to avoid conflicts
    const assignedUsers = alias(users, "assigned_users");
    const createdByUsers = alias(users, "created_by_users");

    logger.info("🔍 About to execute database query with joins...");

    const whereConditions = [eq(projects.organizationId, organizationId)];

    // SECURITY: If user is a client, strictly enforce their own projects
    if (req.user?.role === "client") {
      const clientRecord = await database.query.clients.findFirst({
        where: (clients, { eq }) => eq(clients.userId, req.user!.id),
      });

      if (clientRecord) {
        whereConditions.push(eq(projects.clientId, clientRecord.id));
      } else {
        // If client record not found, return empty set for security
        res.status(200).json({
          success: true,
          message: "Projects fetched successfully",
          data: [],
        });
        return;
      }
    } else {
      // For non-clients (admins/users), apply original visibility/assignment filters
      whereConditions.push(
        or(
          eq(projects.createdBy, req.user?.id as string),
          eq(projects.assignedTo, req.user?.id as string),
          eq(projects.visibility, "public"),
        ) as any,
      );
    }

    const projectsData = await database
      .select({
        // ... (all fields)
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
        projectFiles: projects.projectFiles,
        createdBy: projects.createdBy,
        organizationId: projects.organizationId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        clientId: projects.clientId,
        clientName: clients.name,
        clientEmail: clients.email,
        assignedUserName: assignedUsers.name,
        assignedUserEmail: assignedUsers.email,
        createdByName: createdByUsers.name,
        createdByEmail: createdByUsers.email,
        visibility: projects.visibility,
        customFields: projects.customFields,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(assignedUsers, eq(projects.assignedTo, assignedUsers.id))
      .leftJoin(createdByUsers, eq(projects.createdBy, createdByUsers.id))
      .where(and(...whereConditions))
      .orderBy(desc(projects.createdAt));

    logger.info(
      "✅ Simple database query executed successfully. Found projects:",
      projectsData.length,
    );

    // Transform the data to match frontend expectations
    const transformedProjects = projectsData.map((project) => ({
      id: project.id,
      projectNumber: project.projectNumber,
      projectName: project.name,
      clientName: project.clientName || "Unknown Client",
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
      visibility: project.visibility,
      // Additional fields for frontend
      clientId: project.clientId,
      assignedTo: project.assignedTo,
      contractfile: project.contractfile,
      projectFiles: project.projectFiles,
      customFields: project.customFields,
    }));

    logger.info(
      `Fetched ${transformedProjects.length} projects for organization ${organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Projects fetched successfully",
      data: transformedProjects,
    });
  } catch (error) {
    logger.error("Error fetching projects:", error);
    console.error("Full error:", error);
    res.status(500).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getProjectById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user.organizationId as string;
    const userRole = req.user.role;

    // Security check for clients: They can only see their own projects
    let clientCondition = undefined;
    if (userRole === "client") {
      // Find the client record associated with this user ID
      const clientRecord = await database.query.clients.findFirst({
        where: (clients, { eq }) => eq(clients.userId, req.user!.id),
      });

      if (!clientRecord) {
        res.status(403).json({
          success: false,
          message: "Client profile not found for this user",
        });
        return;
      }

      clientCondition = eq(projects.clientId, clientRecord.id);
    }

    // Create aliases for users table to avoid conflicts
    const assignedUsers = alias(users, "assigned_users");
    const createdByUsers = alias(users, "created_by_users");

    const visibilityConditions = [
      eq(projects.createdBy, req.user!.id),
      eq(projects.assignedTo, req.user!.id),
      eq(projects.visibility, "public"),
    ];

    if (clientCondition) {
      visibilityConditions.push(clientCondition);
    }

    const project = await database
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
        projectFiles: projects.projectFiles,
        createdBy: projects.createdBy,
        organizationId: projects.organizationId,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        // Client information
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        clientImage: clients.image,
        // Assigned user information
        assignedUserName: assignedUsers.name,
        assignedUserEmail: assignedUsers.email,
        // Created by user information
        createdByName: createdByUsers.name,
        createdByEmail: createdByUsers.email,
        visibility: projects.visibility,
        customFields: projects.customFields,
      })
      .from(projects)
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(assignedUsers, eq(projects.assignedTo, assignedUsers.id))
      .leftJoin(createdByUsers, eq(projects.createdBy, createdByUsers.id))
      .where(
        and(
          eq(projects.id, id),
          eq(projects.organizationId, organizationId),
          or(...visibilityConditions),
        ),
      )
      .limit(1);

    if (!project.length) {
      res.status(404).json({
        success: false,
        message: "Project not found",
      });
      return;
    }

    const projectData = project[0];

    const transformedProject = {
      id: projectData.id,
      projectNumber: projectData.projectNumber,
      projectName: projectData.name,
      clientName: projectData.clientName || "Unknown Client",
      clientImage: projectData.clientImage,
      description: projectData.description || "",
      startDate: projectData.startDate ? new Date(projectData.startDate) : null,
      endDate: projectData.endDate ? new Date(projectData.endDate) : null,
      assignedProject: projectData.assignedUserName || "Unassigned",
      address: projectData.address || "",
      budget: projectData.budget,
      status: projectData.status || "pending",
      progress: projectData.progress || 0,
      createdBy: projectData.createdByName || "Unknown",
      organizationId: projectData.organizationId,
      createdAt: new Date(projectData.createdAt),
      updatedAt: new Date(projectData.updatedAt),
      visibility: projectData.visibility,
      // Additional fields
      clientId: projectData.clientId,
      assignedTo: projectData.assignedTo,
      contractfile: projectData.contractfile,
      projectFiles: projectData.projectFiles,
      customFields: projectData.customFields,
    };

    logger.info(
      `Fetched project ${id} for organization ${req.user.organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Project fetched successfully",
      data: transformedProject,
    });
  } catch (error) {
    logger.error("Error fetching project:", error);
    console.error("Full error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getOrganizationClients = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user.organizationId;

    const clientsData = await database
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        phone: clients.phone,
        address: clients.address,
        organizationId: clients.organizationId,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
      })
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .orderBy(desc(clients.createdAt));

    logger.info(
      `Fetched ${clientsData.length} clients for organization ${organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Clients fetched successfully",
      data: clientsData,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getOrganizationUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user.organizationId;

    const usersData = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        organizationId: userOrganizations.organizationId,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(userOrganizations, eq(users.id, userOrganizations.userId))
      .where(
        and(
          eq(userOrganizations.organizationId, organizationId),
          // Exclude the currently logged-in user
          ne(users.id, req.user?.id as string),
        ),
      )
      .orderBy(desc(users.createdAt));

    logger.info(
      `Fetched ${usersData.length} users for organization ${organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: usersData,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
