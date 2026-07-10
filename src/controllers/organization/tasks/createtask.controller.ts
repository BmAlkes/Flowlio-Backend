import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import status from "http-status";
import { tasks, projects } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { logActivity } from "@/utils/activity.util";
import { logger } from "@/utils/logger.util";
import { automationService } from "@/services/automation/automation.service";
import { canCreateTask } from "@/utils/plan-access.util";

interface CreateTaskRequest extends Request {
  user?: {
    id: string;
    organizationId?: string;
    role: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isSuperAdmin: boolean;
    createdAt: Date;
    updatedAt: Date;
    organization?: any;
    userOrganization?: any;
  };
  body: {
    title: string;
    description?: string;
    projectId: string;
    assignedTo?: string;
    startDate?: string;
    endDate?: string;
    estimatedHours?: number;
    actualHours?: number;
    attachments?: Array<{
      id: string;
      file?: string;
      name: string;
      url?: string;
      size: number;
      type: string;
    }>;
    parentId?: string;
    startAfter?: string;
    finishBefore?: string;
    visibility?: "public" | "private";
  };
}

export const createTask = async (
  req: CreateTaskRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id: userId } = req.user;

    const {
      title,
      description,
      projectId,
      assignedTo,
      startDate,
      endDate,
      estimatedHours,
      actualHours,
      attachments,
      parentId,
      startAfter,
      finishBefore,
      visibility,
    } = req.body;

    // Validate required fields
    if (!title || !projectId) {
      res.status(400).json({
        success: false,
        message: "Title and projectId are required.",
      });
      return;
    }

    const orgId = req.user?.organizationId;
    if (orgId) {
      const taskAccess = await canCreateTask(orgId);
      if (!taskAccess.hasAccess) {
        res.status(403).json({ success: false, message: taskAccess.reason });
        return;
      }
    }

    // Normalize parentId: empty string -> null
    const normalizedParentId =
      parentId === "" || parentId == null ? null : parentId;

    // If parentId provided, validate parent exists and same project
    if (normalizedParentId) {
      const organizationId = (req.user as any)?.organizationId;
      const parentTask = await database
        .select({ id: tasks.id, projectId: tasks.projectId })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.id, normalizedParentId),
            eq(projects.organizationId, organizationId as string),
          ),
        )
        .limit(1);

      if (!parentTask.length) {
        res.status(400).json({
          success: false,
          message: "Parent task not found",
        });
        return;
      }

      if (parentTask[0].projectId !== projectId) {
        res.status(400).json({
          success: false,
          message: "Subtask must belong to same project as parent task",
        });
        return;
      }
    }

    // Handle file uploads if attachments are provided
    let processedAttachments: { id: string; name: string; url: string; size: number; type: string }[] = [];

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      try {
        const uploadedAttachments: { id: string; name: string; url: string; size: number; type: string }[] = [];

        for (const attachment of attachments) {
          if (attachment.file && attachment.name && attachment.type) {
            // Upload file to Cloudinary
            const uploadResult = await uploadToCloudinary(
              attachment.file,
              "tasks",
            );

            uploadedAttachments.push({
              id: attachment.id,
              name: attachment.name,
              url: uploadResult.secure_url,
              size: attachment.size,
              type: attachment.type,
            });
          }
        }

        processedAttachments = uploadedAttachments;
      } catch (uploadError) {
        res.status(status.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: "Failed to upload attachments",
        });
        return;
      }
    }

    // Create task
    const taskData = {
      title,
      description,
      projectId,
      assignedTo: assignedTo || null,
      createdBy: userId,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      estimatedHours: estimatedHours ? estimatedHours.toString() : null,
      actualHours: actualHours ? actualHours.toString() : null,
      attachments: processedAttachments,
      parentId: normalizedParentId,
      startAfter: startAfter || null,
      finishBefore: finishBefore || null,
      visibility: visibility || "private",
    };

    const newTask = await database.insert(tasks).values(taskData).returning();

    const organizationId = (req.user as any)?.organizationId;
    if (organizationId) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: assignedTo || undefined,
        type: "task",
        action: "create",
        resource: "task",
        resourceId: newTask[0].id,
        message: `Created task: ${title}`,
        metadata: { projectId, assignedTo },
      });

      // Recalculate project progress
      await automationService
        .recalculateProjectProgress(projectId)
        .catch((err) => {
          logger.error(
            `Failed to recalculate progress for project ${projectId}:`,
            err,
          );
        });

      // Handle Auto Assign Task if enabled
      await automationService
        .handleAutoAssignTask(projectId, newTask[0].id)
        .catch((err) => {
          logger.error(`Failed to auto-assign task ${newTask[0].id}:`, err);
        });
    }

    res.status(201).json({
      success: true,
      message: "Task created successfully",
      data: newTask[0],
    });
  } catch (error) {
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
  }
};
