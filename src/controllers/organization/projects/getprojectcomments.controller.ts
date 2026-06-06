import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectComments, users } from "../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

interface GetProjectCommentsRequest extends Request {
  params: {
    projectId: string;
  };
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

export const getProjectComments = async (
  req: GetProjectCommentsRequest,
  res: Response
) => {
  try {
    const { projectId } = req.params;
    const taskId = req.query.taskId as string | undefined;

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if projectId is provided
    if (!projectId) {
      res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

    // Build where clause — optionally filter by taskId
    const whereClause = taskId
      ? and(eq(projectComments.projectId, projectId), eq(projectComments.taskId, taskId))
      : eq(projectComments.projectId, projectId);

    // Get comments for the project (optionally scoped to a task) with user information
    const comments = await database
      .select({
        id: projectComments.id,
        projectId: projectComments.projectId,
        taskId: projectComments.taskId,
        userId: projectComments.userId,
        userName: users.name,
        content: projectComments.content,
        parentId: projectComments.parentId,
        createdAt: projectComments.createdAt,
        updatedAt: projectComments.updatedAt,
      })
      .from(projectComments)
      .leftJoin(users, eq(projectComments.userId, users.id))
      .where(whereClause)
      .orderBy(projectComments.createdAt);

    if (comments.length === 0) {
      res.status(200).json({
        success: true,
        message: "No comments found for this project",
        data: [],
      });
      return;
    }

    // Organize comments into a hierarchical structure
    const commentMap = new Map<string, any>();
    const topLevelComments: any[] = [];

    // First pass: create a map of all comments
    comments.forEach((comment) => {
      commentMap.set(comment.id, {
        ...comment,
        replies: [],
      });
    });

    // Second pass: organize into hierarchy
    comments.forEach((comment) => {
      if (comment.parentId) {
        // This is a reply
        const parentComment = commentMap.get(comment.parentId);
        if (parentComment) {
          parentComment.replies.push(commentMap.get(comment.id));
        }
      } else {
        // This is a top-level comment
        topLevelComments.push(commentMap.get(comment.id));
      }
    });

    // Return success response
    res.status(200).json({
      success: true,
      message: "Comments retrieved successfully",
      data: topLevelComments,
      totalComments: comments.length,
    });
    return;
  } catch (error) {
    logger.error("Error retrieving project comments:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
    return;
  }
};
