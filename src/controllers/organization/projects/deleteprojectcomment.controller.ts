import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { projectComments } from "../../../../drizzle/schema";

interface DeleteProjectCommentRequest extends Request {
  params: {
    commentId: string;
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

export const deleteProjectComment = async (
  req: DeleteProjectCommentRequest,
  res: Response
) => {
  try {
    const { commentId } = req.params;

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if commentId is provided
    if (!commentId) {
      res.status(400).json({
        success: false,
        message: "Comment ID is required",
      });
      return;
    }

    // Get the comment to check ownership and get project ID
    const comment = await database
      .select({
        id: projectComments.id,
        userId: projectComments.userId,
        projectId: projectComments.projectId,
        parentId: projectComments.parentId,
      })
      .from(projectComments)
      .where(eq(projectComments.id, commentId))
      .limit(1);

    if (comment.length === 0) {
      res.status(404).json({
        success: false,
        message: "Comment not found",
      });
      return;
    }

    const commentData = comment[0];

    // Check if user owns the comment or has admin privileges
    if (commentData.userId !== req.user.id && req.user.role !== "admin") {
      res.status(403).json({
        success: false,
        message: "You can only delete your own comments",
      });
      return;
    }

    // Delete the comment and all its replies
    const deletedComment = await database
      .delete(projectComments)
      .where(
        and(
          eq(projectComments.id, commentId),
          eq(projectComments.userId, req.user.id)
        )
      )
      .returning();

    if (deletedComment.length === 0) {
      res.status(500).json({
        success: false,
        message: "Failed to delete comment",
      });
      return;
    }

    // Return success response
    res.status(200).json({
      success: true,
      message: "Comment deleted successfully",
      data: {
        deletedCommentId: commentId,
        projectId: commentData.projectId,
      },
    });
    return;
  } catch (error) {
    logger.error("Error deleting project comment:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
    return;
  }
};
