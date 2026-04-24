import { Response } from "express";
import { database } from "../../../configs/connection.config";
import { updateProjectSchema } from "../../../schema/validation";
import { projects } from "../../../schema/schema";
import { z } from "zod";
import { eq, and, ne } from "drizzle-orm";
import {
  clients,
  users,
  userOrganizations,
  tasks,
} from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import {
  requireOrganizationId,
  validateOrganizationId,
} from "@/utils/organization.util";

interface UpdateProjectRequest {
  body: z.infer<typeof updateProjectSchema>;
  params: {
    id: string;
  };
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId: string;
  };
}

export const updateProject = async (
  req: UpdateProjectRequest,
  res: Response,
): Promise<void> => {
  try {
    const projectId = req.params.id;

    // Validate request body
    const validatedData = updateProjectSchema.parse(req.body);

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Get organization ID from authenticated user
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) {
      return; // Response already sent by requireOrganizationId
    }

    // Validate that provided organization ID (if any) matches user's organization
    if (
      validatedData.organizationId &&
      !validateOrganizationId(req as any, res, validatedData.organizationId)
    ) {
      return; // Response already sent by validateOrganizationId
    }

    // Get existing project to use as fallback for missing fields
    const existingProject = await database
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existingProject.length === 0) {
      res.status(404).json({
        success: false,
        message: "Project not found or you don't have permission to update it",
      });
      return;
    }

    // const currentProject = existingProject[0];

    // Check if project with same name already exists in the organization (only if updating name)
    if (validatedData.name) {
      const duplicateProject = await database
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.name, validatedData.name),
            eq(projects.organizationId, organizationId),
          ),
        )
        .limit(1);

      // If a duplicate project exists and it's not the current project, return error
      if (duplicateProject.length > 0 && duplicateProject[0].id !== projectId) {
        res.status(409).json({
          success: false,
          message: "Project with this name already exists in this organization",
        });
        return;
      }
    }

    // Validate that the client belongs to the organization (only if updating clientId)
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

      if (clientExists.length === 0) {
        res.status(400).json({
          success: false,
          message: "Selected client does not belong to your organization",
        });
        return;
      }
    }

    // Validate that the assigned user belongs to the organization (only if updating assignedTo)
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

      if (assignedUserExists.length === 0) {
        res.status(400).json({
          success: false,
          message: "Selected user does not belong to your organization",
        });
        return;
      }
    }

    let contractfileUrl = existingProject[0].contractfile;
    let contractfilePublicId = existingProject[0].contractfilePublicId;
    let projectFiles = existingProject[0].projectFiles;

    // Handle contract file upload if provided
    if (
      validatedData.contractfile &&
      typeof validatedData.contractfile === "string" &&
      validatedData.contractfile.startsWith("data:")
    ) {
      try {
        const uploadResult = await uploadToCloudinary(
          validatedData.contractfile,
          "projects",
        );
        contractfileUrl = uploadResult.secure_url;
        contractfilePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Contract file upload failed:", uploadError);
        res.status(500).json({
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
        const uploadedFiles: any = projectFiles || {};

        for (const fileData of validatedData.projectFiles) {
          if (fileData.file && fileData.type && fileData.name) {
            const uploadResult = await uploadToCloudinary(
              fileData.file,
              "projects",
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
        res.status(500).json({
          success: false,
          message: "Failed to upload project files",
        });
        return;
      }
    }

    // Prepare update data - only include fields that are being updated
    const updateData: any = {
      updatedAt: new Date(),
    };

    // Only update fields that are provided in the request
    if (validatedData.name !== undefined) updateData.name = validatedData.name;
    if (validatedData.projectNumber !== undefined)
      updateData.projectNumber = validatedData.projectNumber;
    if (validatedData.clientId !== undefined)
      updateData.clientId = validatedData.clientId;
    if (validatedData.description !== undefined)
      updateData.description = validatedData.description;
    if (validatedData.assignedTo !== undefined)
      updateData.assignedTo = validatedData.assignedTo;
    if (validatedData.startDate !== undefined)
      updateData.startDate = validatedData.startDate
        ? new Date(validatedData.startDate)
        : null;
    if (validatedData.endDate !== undefined)
      updateData.endDate = validatedData.endDate
        ? new Date(validatedData.endDate)
        : null;
    if (validatedData.address !== undefined)
      updateData.address = validatedData.address;
    if (validatedData.status !== undefined)
      updateData.status = validatedData.status;
    if (validatedData.progress !== undefined)
      updateData.progress = validatedData.progress;
    if (validatedData.customFields !== undefined)
      updateData.customFields = validatedData.customFields;
    if (validatedData.visibility !== undefined)
      updateData.visibility = validatedData.visibility;
    if (validatedData.budget !== undefined)
      updateData.budget =
        validatedData.budget != null ? String(validatedData.budget) : null;

    // If project is marked as completed, verify all tasks are completed and set progress to 100%
    if (validatedData.status === "completed") {
      const incompleteTasks = await database
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.projectId, projectId), ne(tasks.status, "completed")),
        )
        .limit(1);

      if (incompleteTasks.length > 0) {
        res.status(400).json({
          success: false,
          message: "please complete all tasks first related to this project.",
        });
        return;
      }

      updateData.progress = 100;
    }

    // Always update file-related fields if they were processed
    updateData.contractfile = contractfileUrl;
    updateData.contractfilePublicId = contractfilePublicId;
    updateData.projectFiles = projectFiles;

    // Update project
    const updatedProject = await database
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, projectId))
      .returning();

    if (updatedProject.length === 0) {
      res.status(500).json({
        success: false,
        message: "Failed to update project",
      });
      return;
    }

    const project = updatedProject[0];

    // Check if project status changed to "completed"
    const previousStatus = existingProject[0]?.status;
    const isNewlyCompleted =
      validatedData.status === "completed" && previousStatus !== "completed";

    // Log activity
    const userId = req.user?.id;
    // organizationId is already defined above
    if (organizationId && userId && existingProject.length > 0) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: project.assignedTo || undefined,
        type: "project",
        action: "update",
        resource: "project",
        resourceId: projectId,
        message: `Updated project: ${project.name}`,
        metadata: { updatedFields: Object.keys(updateData) },
      });
    }

    // Notify super admins if project was just completed (non-blocking)
    if (isNewlyCompleted) {
      // Get organization info
      const organization = await database.query.organizations.findFirst({
        where: (orgs, { eq }) => eq(orgs.id, project.organizationId),
        columns: {
          name: true,
        },
      });

      // Get assigned user info if available
      let assignedUserInfo = "Unassigned";
      if (project.assignedTo) {
        const assignedUser = await database.query.users.findFirst({
          where: (users, { eq }) => eq(users.id, project.assignedTo!),
          columns: {
            name: true,
            email: true,
          },
        });
        if (assignedUser) {
          assignedUserInfo =
            assignedUser.name || assignedUser.email || "Unknown";
        }
      }

      notifySuperAdmins({
        type: "projectCompletion",
        title: "Project Completed",
        message: `The project "${project.name}" has been marked as completed.`,
        details: {
          "Project Name": project.name,
          "Project Number": project.projectNumber || "N/A",
          Organization: organization?.name || "Unknown",
          "Assigned To": assignedUserInfo,
          "Completion Date": new Date().toLocaleString(),
        },
      }).catch((error) => {
        logger.error("Failed to send project completion notification:", error);
      });
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: "Project updated successfully",
      data: {
        id: project.id,
        name: project.name,
        projectNumber: project.projectNumber,
        clientId: project.clientId,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        assignedTo: project.assignedTo,
        status: project.status,
        progress: project.progress,
        address: project.address,
        budget: project.budget,
        contractfile: project.contractfile,
        contractfilePublicId: project.contractfilePublicId,
        organizationId: project.organizationId,
        visibility: project.visibility,
        createdBy: project.createdBy,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
