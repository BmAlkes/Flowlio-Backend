import { Response } from "express";
import { database } from "../../../configs/connection.config";
import { createProjectSchema } from "../../../schema/validation";
import { projects, tasks, projectTemplateTasks } from "../../../schema/schema";
import { z } from "zod";
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { clients, users, userOrganizations } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";
import { canCreateProject, canUploadFile } from "@/utils/plan-access.util";
import {
  requireOrganizationId,
  validateOrganizationId,
} from "@/utils/organization.util";
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
  res: Response,
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

    // Get organization ID from authenticated user (more secure than accepting from body)
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) {
      return; // Response already sent by requireOrganizationId
    }

    // Validate that provided organization ID (if any) matches user's organization
    if (
      !validateOrganizationId(req as any, res, validatedData.organizationId)
    ) {
      return; // Response already sent by validateOrganizationId
    }

    // Check plan limit for project creation
    const planCheck = await canCreateProject(organizationId);
    if (!planCheck.hasAccess) {
      logger.warn(
        `⚠️ Project creation blocked for organization ${organizationId}: ${planCheck.reason}`,
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

    // Check if project with same name already exists in the organization
    const existingProject = await database
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.name, validatedData.name),
          eq(projects.organizationId, organizationId),
        ),
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
        `Validating client ${validatedData.clientId} for organization ${organizationId}`,
      );

      const clientExists = await database
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.id, validatedData.clientId),
            eq(clients.organizationId, organizationId),
          ),
        )
        .limit(1);

      logger.info(
        `Client validation result: ${clientExists.length} clients found`,
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
        `Validating user ${validatedData.assignedTo} for organization ${organizationId}`,
      );

      const assignedUserExists = await database
        .select()
        .from(users)
        .innerJoin(userOrganizations, eq(users.id, userOrganizations.userId))
        .where(
          and(
            eq(users.id, validatedData.assignedTo),
            eq(userOrganizations.organizationId, organizationId),
          ),
        )
        .limit(1);

      logger.info(
        `User validation result: ${assignedUserExists.length} users found`,
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
    let totalFileSizeBytes = 0;

    // Helper function to calculate file size from base64 string
    const getBase64FileSize = (base64String: string): number => {
      // Remove data URL prefix if present (e.g., "data:image/png;base64,")
      const base64Data = base64String.includes(",")
        ? base64String.split(",")[1]
        : base64String;
      // Base64 encoding increases size by ~33%, so we calculate the original size
      // Each base64 character represents 6 bits, so 4 characters = 3 bytes
      return (base64Data.length * 3) / 4;
    };

    // Check storage limit before uploading contract file
    if (
      validatedData.contractfile &&
      typeof validatedData.contractfile === "string" &&
      validatedData.contractfile.startsWith("data:")
    ) {
      const fileSizeBytes = getBase64FileSize(validatedData.contractfile);
      totalFileSizeBytes += fileSizeBytes;

      const storageCheck = await canUploadFile(
        organizationId,
        totalFileSizeBytes,
      );
      if (!storageCheck.hasAccess) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: storageCheck.reason || "Storage limit exceeded",
          data: {
            currentStorage: storageCheck.currentCount,
            maxStorage: storageCheck.maxAllowed,
          },
        });
        return;
      }

      try {
        const uploadResult = await uploadToCloudinary(
          validatedData.contractfile,
          "projects",
        );
        contractfileUrl = uploadResult.secure_url;
        contractfilePublicId = uploadResult.public_id;
        // Use actual bytes from Cloudinary if available, otherwise use calculated size
        if (uploadResult.bytes) {
          totalFileSizeBytes = uploadResult.bytes;
        }
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
        let projectFilesSizeBytes = 0;

        // Calculate total size of all project files before uploading
        for (const fileData of validatedData.projectFiles) {
          if (fileData.file && fileData.type && fileData.name) {
            let fileSizeBytes = 0;
            if (
              typeof fileData.file === "string" &&
              fileData.file.startsWith("data:")
            ) {
              fileSizeBytes = getBase64FileSize(fileData.file);
            } else if (
              fileData.file &&
              typeof fileData.file === "object" &&
              "size" in fileData.file
            ) {
              fileSizeBytes = (fileData.file as any).size || 0;
            }
            projectFilesSizeBytes += fileSizeBytes;
          }
        }

        // Check storage limit for all project files
        const storageCheck = await canUploadFile(
          organizationId,
          totalFileSizeBytes + projectFilesSizeBytes,
        );
        if (!storageCheck.hasAccess) {
          res.status(status.FORBIDDEN).json({
            success: false,
            message: storageCheck.reason || "Storage limit exceeded",
            data: {
              currentStorage: storageCheck.currentCount,
              maxStorage: storageCheck.maxAllowed,
            },
          });
          return;
        }

        // Upload files
        for (const fileData of validatedData.projectFiles) {
          if (fileData.file && fileData.type && fileData.name) {
            const uploadResult = await uploadToCloudinary(
              fileData.file,
              "projects",
            );

            // Only handle projectPdf type
            if (fileData.type === "projectPdf") {
              const fileSize = uploadResult.bytes || 0;
              uploadedFiles.projectPdf = {
                url: uploadResult.secure_url,
                publicId: uploadResult.public_id,
                name: fileData.name,
                type: fileData.type,
                size: fileSize, // Store file size in bytes
              };
              // Update total file size with actual Cloudinary bytes if available
              if (uploadResult.bytes) {
                totalFileSizeBytes += uploadResult.bytes;
              } else {
                totalFileSizeBytes += projectFilesSizeBytes;
              }
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
        organizationId: organizationId,
        createdBy: req.user?.id as string,
        assignedTo: validatedData.assignedTo ?? null,
        startDate: validatedData.startDate
          ? new Date(validatedData.startDate)
          : null,
        endDate: validatedData.endDate ? new Date(validatedData.endDate) : null,
        status: "pending",
        visibility: validatedData.visibility ?? "private",
        progress: 0,
        address: validatedData.address ?? null,
        budget:
          validatedData.budget != null ? String(validatedData.budget) : null,
        contractfile: contractfileUrl ?? null,
        contractfilePublicId: contractfilePublicId ?? null,
        projectFiles: projectFiles
          ? {
              ...projectFiles,
              totalSize:
                totalFileSizeBytes > 0 ? Math.round(totalFileSizeBytes) : 0, // Store total file size in bytes in JSON
            }
          : null,
        customFields: validatedData.customFields ?? null,
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

    // Handle template-based task creation
    if (validatedData.templateId) {
      try {
        const templateTasks = await database
          .select()
          .from(projectTemplateTasks)
          .where(eq(projectTemplateTasks.templateId, validatedData.templateId));

        if (templateTasks.length > 0) {
          const projectDeadline = createdProject.endDate;
          const taskValues = templateTasks.map((tTask) => ({
            id: randomUUID(),
            title: tTask.title,
            description: tTask.description,
            projectId: createdProject.id,
            createdBy: req.user?.id as string,
            assignedTo: createdProject.assignedTo,
            status: "todo" as any,
            endDate: projectDeadline,
            estimatedHours: tTask.estimatedHours,
            createdAt: new Date(),
            updatedAt: new Date(),
          }));

          await database.insert(tasks).values(taskValues);
          logger.info(
            `✅ Created ${templateTasks.length} tasks from template ${validatedData.templateId} for project ${createdProject.id}`,
          );
        }
      } catch (templateError) {
        logger.error("Failed to create tasks from template:", templateError);
        // Non-blocking error, project was still created
      }
    }

    // Log activity
    const userId = req.user?.id;
    // Use the organizationId already defined above
    if (userId) {
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
        budget: createdProject.budget,
        contractfile: createdProject.contractfile,
        contractfilePublicId: createdProject.contractfilePublicId,
        organizationId: createdProject.organizationId,
        visibility: createdProject.visibility,
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
