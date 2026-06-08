import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { updateProjectCommentSchema } from "@/schema/validation";
import { projectComments, users } from "../../../../drizzle/schema";
import { eq } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

export const updateProjectComment = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const { commentId } = req.params;

    const parsed = updateProjectCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: parsed.error.errors[0].message });
      return;
    }

    const existing = await database
      .select({
        id: projectComments.id,
        userId: projectComments.userId,
        projectId: projectComments.projectId,
        taskId: projectComments.taskId,
        parentId: projectComments.parentId,
        content: projectComments.content,
        createdAt: projectComments.createdAt,
      })
      .from(projectComments)
      .where(eq(projectComments.id, commentId))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ success: false, message: "Comment not found" });
      return;
    }

    if (existing[0].userId !== req.user.id) {
      res.status(403).json({ success: false, message: "You can only edit your own comments" });
      return;
    }

    const updated = await database
      .update(projectComments)
      .set({ content: parsed.data.content, updatedAt: new Date().toISOString() as any })
      .where(eq(projectComments.id, commentId))
      .returning();

    const comment = updated[0];

    const userRow = await database
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, comment.userId))
      .limit(1);

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      data: {
        id: comment.id,
        projectId: comment.projectId,
        taskId: comment.taskId,
        parentId: comment.parentId,
        userId: comment.userId,
        userName: userRow[0]?.name ?? null,
        content: comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      },
    });
  } catch (error) {
    logger.error("Error updating project comment:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
