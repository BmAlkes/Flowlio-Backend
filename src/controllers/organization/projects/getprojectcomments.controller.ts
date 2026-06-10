import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectComments, users } from "../../../../drizzle/schema";
import { asc, eq } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

export const getProjectComments = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const projectId = req.params.projectId as string | undefined;
    const taskId = req.query.taskId as string | undefined;

    if (!projectId) {
      res.status(400).json({ success: false, message: "projectId is required" });
      return;
    }

    // taskId filter is intentionally disabled: the task_id column exists in the
    // Drizzle schema but has not been migrated to production yet.
    // Re-enable once: ALTER TABLE project_comments ADD COLUMN IF NOT EXISTS task_id text;
    void taskId;

    const comments = await database
      .select({
        id: projectComments.id,
        projectId: projectComments.projectId,
        userId: projectComments.userId,
        userName: users.name,
        userImage: users.image,
        content: projectComments.content,
        parentId: projectComments.parentId,
        createdAt: projectComments.createdAt,
        updatedAt: projectComments.updatedAt,
      })
      .from(projectComments)
      .leftJoin(users, eq(projectComments.userId, users.id))
      .where(eq(projectComments.projectId, projectId))
      .orderBy(asc(projectComments.createdAt));

    if (comments.length === 0) {
      res.status(200).json({ success: true, data: [], totalComments: 0 });
      return;
    }

    const commentMap = new Map<string, any>();
    const topLevelComments: any[] = [];

    comments.forEach((comment) => {
      commentMap.set(comment.id, { ...comment, replies: [] });
    });

    comments.forEach((comment) => {
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId);
        if (parent) parent.replies.push(commentMap.get(comment.id));
      } else {
        topLevelComments.push(commentMap.get(comment.id));
      }
    });

    res.status(200).json({
      success: true,
      data: topLevelComments,
      totalComments: comments.length,
    });
  } catch (error: any) {
    logger.error("Error retrieving project comments:", {
      message: error?.message,
      cause: error?.cause,
      detail: error?.detail,
    });
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.cause?.message ?? error?.message ?? "Internal server error",
    });
  }
};
