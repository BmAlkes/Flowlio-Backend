import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { updateProjectCommentSchema } from "@/schema/validation";
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

    // Fetch existing comment to verify ownership
    const existing = await connection.query<{
      id: string;
      userId: string;
    }>({
      text: `SELECT id, user_id AS "userId" FROM project_comments WHERE id = $1 LIMIT 1`,
      values: [commentId],
    });

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, message: "Comment not found" });
      return;
    }

    if (existing.rows[0].userId !== req.user.id) {
      res.status(403).json({ success: false, message: "You can only edit your own comments" });
      return;
    }

    const now = new Date().toISOString();

    const updated = await connection.query<{
      id: string;
      projectId: string;
      parentId: string | null;
      userId: string;
      content: string;
      createdAt: string;
      updatedAt: string;
    }>({
      text: `
        UPDATE project_comments
        SET content = $1, updated_at = $2
        WHERE id = $3
        RETURNING
          id,
          project_id  AS "projectId",
          parent_id   AS "parentId",
          user_id     AS "userId",
          content,
          created_at  AS "createdAt",
          updated_at  AS "updatedAt"
      `,
      values: [parsed.data.content, now, commentId],
    });

    const comment = updated.rows[0];

    // Fetch user name
    const userRow = await connection.query<{ name: string }>({
      text: `SELECT name FROM users WHERE id = $1 LIMIT 1`,
      values: [comment.userId],
    });

    res.status(200).json({
      success: true,
      message: "Comment updated successfully",
      data: {
        id: comment.id,
        projectId: comment.projectId,
        parentId: comment.parentId ?? null,
        userId: comment.userId,
        userName: userRow.rows[0]?.name ?? null,
        content: comment.content,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
      },
    });
  } catch (error: any) {
    logger.error("Error updating project comment:", {
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
