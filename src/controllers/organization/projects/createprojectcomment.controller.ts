import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { createProjectCommentSchema } from "@/schema/validation";
import { z } from "zod";
import { eq } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { projectComments, projects } from "../../../../drizzle/schema";
import { randomUUID } from "crypto";

interface CreateProjectCommentRequest extends Request {
  body: z.infer<typeof createProjectCommentSchema>;
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
    isSuperAdmin: boolean;
    subadminId?: string;
    createdAt: Date;
    updatedAt: Date;
    role: string;
    organizationId?: string;
    organization?: any;
    userOrganization?: any;
  };
}

export const createProjectComment = async (
  req: CreateProjectCommentRequest,
  res: Response
) => {
  try {
    // Validate request body
    const validatedData = createProjectCommentSchema.parse(req.body);

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if project exists
    const projectExists = await database
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, validatedData.projectId))
      .limit(1);

    if (projectExists.length === 0) {
      res.status(404).json({
        success: false,
        message: "Project not found",
      });
      return;
    }

    // If this is a reply, check if parent comment exists
    if (validatedData.parentId) {
      const parentCommentExists = await database
        .select({ id: projectComments.id })
        .from(projectComments)
        .where(eq(projectComments.id, validatedData.parentId))
        .limit(1);

      if (parentCommentExists.length === 0) {
        res.status(404).json({
          success: false,
          message: "Parent comment not found",
        });
        return;
      }
    }

    // Create new comment
    const newComment = await database
      .insert(projectComments)
      .values({
        id: randomUUID(),
        userId: req.user.id,
        projectId: validatedData.projectId,
        content: validatedData.content,
        parentId: validatedData.parentId || undefined,
        taskId: validatedData.taskId || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();

    if (newComment.length === 0) {
      res.status(500).json({
        success: false,
        message: "Failed to create comment",
      });
      return;
    }

    const createdComment = newComment[0];

    // Return success response
    res.status(201).json({
      success: true,
      message: "Comment created successfully",
      data: {
        id: createdComment.id,
        projectId: createdComment.projectId,
        userId: createdComment.userId,
        content: createdComment.content,
        parentId: createdComment.parentId,
        taskId: createdComment.taskId,
        createdAt: createdComment.createdAt,
        updatedAt: createdComment.updatedAt,
      },
    });
    return;
  } catch (error) {
    logger.error("Error creating project comment:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
    return;
  }
};
