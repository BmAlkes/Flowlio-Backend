import { Response } from "express";
import { database } from "../../../configs/connection.config";
import { createProjectSchema } from "../../../schema/validation";
import { projects } from "../../../schema/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { clients, users, userOrganizations } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";
import { canCreateProject } from "@/utils/plan-access.util";
interface CreateProjectRequest {
  body: z.infer<typeof createProjectSchema>;
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId: string;
  };
}

export const createProject = async (
  req: CreateProjectRequest,
  res: Response
): Promise<void> => {
  try {
    // Validate request body
    const validatedData = createProjectSchema.parse(req.body);

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!validatedData.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Check plan limit for project creation
    const planCheck = await canCreateProject(validatedData.organizationId);
    if (!planCheck.hasAccess) {
      logger.warn(
        `⚠️ Project creation blocked for organization ${validatedData.organizationId}: ${planCheck.reason}`
      );
      res.status(403).json({
        success: false,
        message: planCheck.reason || "Project limit reached for your plan",
        data: {
          currentCount: planCheck.currentCount,
          maxAllowed: planCheck.maxAllowed,
        },
      });
      return;
    }

    // Validate that the organization ID matches the user's organization
    if (validatedData.organizationId !== (req.user as any)?.organizationId) {
      logger.warn(
        `Organization ID mismatch: User's org ID: ${
          (req.user as any)?.organizationId
        }, Request org ID: ${validatedData.organizationId}`
      );
      res.status(400).json({
        success: false,
        message: "Organization ID mismatch. Please refresh and try again.",
      });
      return;
    }

    // Check if project with same name already exists in the organization
    const existingProject = await database
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.name, validatedData.name),
          eq(projects.organizationId, validatedData.organizationId)
        )
      )
      .limit(1);

    if (existingProject.length > 0) {
      res.status(409).json({
        success: false,
        message: "Project with this name already exists in this organization",
      });
      return;
    }

    // Validate that the client belongs to the organization (only if clientId is provided)
    if (validatedData.clientId) {
      logger.info(
        `Validating client ${validatedData.clientId} for organization ${validatedData.organizationId}`
      );

      const clientExists = await database
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.id, validatedData.clientId),
            eq(clients.organizationId, validatedData.organizationId)
          )
        )
        .limit(1);

      logger.info(
        `Client validation result: ${clientExists.length} clients found`
      );

      if (clientExists.length === 0) {
        res.status(400).json({
          success: false,
          message: "Selected client does not belong to your organization",
        });
        return;
      }
    }

    // Validate that the assigned user belongs to the organization (only if assignedTo is provided)
    if (validatedData.assignedTo) {
      logger.info(
        `Validating user ${validatedData.assignedTo} for organization ${validatedData.organizationId}`
      );

      const assignedUserExists = await database
        .select()
        .from(users)
        .innerJoin(userOrganizations, eq(users.id, userOrganizations.userId))
        .where(
          and(
            eq(users.id, validatedData.assignedTo),
            eq(userOrganizations.organizationId, validatedData.organizationId)
          )
        )
        .limit(1);

      logger.info(
        `User validation result: ${assignedUserExists.length} users found`
      );

      if (assignedUserExists.length === 0) {
        res.status(400).json({
          success: false,
          message: "Selected team member does not belong to your organization",
        });
        return;
      }
    }

    let contractfileUrl = null;
    let contractfilePublicId = null;
    let projectFiles = null;

    // Handle contract file upload if provided
    if (
      validatedData.contractfile &&
      typeof validatedData.contractfile === "string" &&
      validatedData.contractfile.startsWith("data:")
    ) {
      try {
        const uploadResult = await uploadToCloudinary(
          validatedData.contractfile,
          "projects"
        );
        contractfileUrl = uploadResult.secure_url;
        contractfilePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Contract file upload failed:", uploadError);
        res.status(status.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to upload contract file",
        });
        return;
      }
    }

    // Handle multiple project files if provided
    if (
      validatedData.projectFiles &&
      Array.isArray(validatedData.projectFiles)
    ) {
      try {
        const uploadedFiles: any = {};

        for (const fileData of validatedData.projectFiles) {
          if (fileData.file && fileData.type && fileData.name) {
            const uploadResult = await uploadToCloudinary(
              fileData.file,
              "projects"
            );

            // Only handle projectPdf type
            if (fileData.type === "projectPdf") {
              uploadedFiles.projectPdf = {
                url: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                name: fileData.name,
                type: fileData.type,
              };
            }
          }
        }

        projectFiles = uploadedFiles;
      } catch (uploadError) {
        console.error("Project files upload failed:", uploadError);
        res.status(status.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to upload project files",
        });
        return;
      }
    }

    // Create new project
    const projectId = randomUUID();
    const newProject = await database
      .insert(projects)
      .values({
        id: projectId,
        name: validatedData.name,
        projectNumber: validatedData.projectNumber ?? "",
        clientId: validatedData.clientId ?? null,
        description: validatedData.description ?? null,
        organizationId: validatedData.organizationId,
        createdBy: req.user?.id as string,
        assignedTo: validatedData.assignedTo ?? null,
        startDate: validatedData.startDate
          ? new Date(validatedData.startDate)
          : null,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        status: "pending",
        progress: 0,
        address: validatedData.address ?? null,
        contractfile: contractfileUrl ?? null,
        contractfilePublicId: contractfilePublicId ?? null,
        projectFiles: projectFiles ?? null,
        tags: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        settings: {
          allowGuestAccess: false,
          autoAssignTasks: false,
          requireApproval: false,
        },
      })
      .returning();

    if (newProject.length === 0) {
      res.status(500).json({
        success: false,
        message: "Failed to create project",
      });
      return;
    }

    const createdProject = newProject[0];

    // Log activity
    const userId = req.user?.id;
    const organizationId = createdProject.organizationId;
    if (organizationId && userId) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: validatedData.assignedTo || undefined,
        type: "project",
        action: "create",
        resource: "project",
        resourceId: createdProject.id,
        message: `Created project: ${validatedData.name}`,
        metadata: {
          clientId: validatedData.clientId,
          assignedTo: validatedData.assignedTo,
        },
      });
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: {
        id: createdProject.id,
        name: createdProject.name,
        projectNumber: createdProject.projectNumber,
        clientId: createdProject.clientId,
        description: createdProject.description,
        startDate: createdProject.startDate,
        endDate: createdProject.endDate,
        assignedTo: createdProject.assignedTo,
        status: createdProject.status,
        progress: createdProject.progress,
        address: createdProject.address,
        contractfile: createdProject.contractfile,
        contractfilePublicId: createdProject.contractfilePublicId,
        organizationId: createdProject.organizationId,
        createdBy: createdProject.createdBy,
        createdAt: createdProject.createdAt,
        updatedAt: createdProject.updatedAt,
      },
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
