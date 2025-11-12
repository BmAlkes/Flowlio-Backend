import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import status from "http-status";
import { tasks } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { logActivity } from "@/utils/activity.util";

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
      file: string;
      name: string;
      url: string;
      size: number;
      type: string;
    }>;
  };
}

export const createTask = async (
  req: CreateTaskRequest,
  res: Response
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
    } = req.body;

    // Validate required fields
    if (!title || !projectId) {
      res.status(400).json({
        success: false,
        message: "Title and projectId are required.",
      });
      return;
    }

    // Handle file uploads if attachments are provided
    let processedAttachments = attachments || [];

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      try {
        const uploadedAttachments = [];

        for (const attachment of attachments) {
          if (attachment.file && attachment.name && attachment.type) {
            // Upload file to Cloudinary
            const uploadResult = await uploadToCloudinary(
              attachment.file,
              "tasks"
            );

            uploadedAttachments.push({
              id: attachment.id,
              file: attachment.file,
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
