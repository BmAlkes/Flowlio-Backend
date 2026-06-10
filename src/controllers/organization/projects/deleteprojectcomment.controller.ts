import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import status from "http-status";
import { logger } from "@/utils/logger.util";

// Better Auth may omit hyphens; PostgreSQL uuid columns require the standard format
function toUUID(id: string): string {
  if (id.includes("-")) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export const deleteProjectComment = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const { commentId } = req.params;
    if (!commentId) {
      res.status(400).json({ success: false, message: "Comment ID is required" });
      return;
    }

    // 1. Fetch comment to verify it exists and check ownership
    const existing = await connection.query<{
      userId: string;
      projectId: string;
    }>({
      text: `SELECT user_id AS "userId", project_id AS "projectId" FROM project_comments WHERE id = $1 LIMIT 1`,
      values: [commentId],
    });

    if (existing.rows.length === 0) {
      res.status(404).json({ success: false, message: "Comment not found" });
      return;
    }

    const { userId: storedUserId, projectId } = existing.rows[0];
    const actorId = toUUID(user.id);
    const isOwner = toUUID(storedUserId) === actorId;
    const isAdmin = user.role === "admin" || user.role === "owner";

    if (!isOwner && !isAdmin) {
      res.status(403).json({ success: false, message: "You can only delete your own comments" });
      return;
    }

    // 2. DELETE by id only — ownership already verified above
    const deleted = await connection.query({
      text: `DELETE FROM project_comments WHERE id = $1`,
      values: [commentId],
    });

    if (deleted.rowCount === 0) {
      res.status(500).json({ success: false, message: "Failed to delete comment" });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Comment deleted successfully",
      data: { deletedCommentId: commentId, projectId },
    });
  } catch (error: any) {
    logger.error("Error deleting project comment:", {
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
