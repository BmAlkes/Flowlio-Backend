import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { createProjectCommentSchema } from "@/schema/validation";
import { z } from "zod";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { randomUUID } from "crypto";
import { notifyProjectComment, notifyCommentMentions } from "@/utils/comment-notification.util";

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
    const validatedData = createProjectCommentSchema.parse(req.body);

    if (!req.user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    // Check project exists
    const projectCheck = await connection.query<{ id: string; name: string }>({
      text: `SELECT id, name FROM projects WHERE id = $1 LIMIT 1`,
      values: [validatedData.projectId],
    });
    if (projectCheck.rows.length === 0) {
      res.status(404).json({ success: false, message: "Project not found" });
      return;
    }
    const projectName = projectCheck.rows[0].name;

    // Check parent comment exists (if reply)
    if (validatedData.parentId) {
      const parentCheck = await connection.query({
        text: `SELECT id FROM project_comments WHERE id = $1 LIMIT 1`,
        values: [validatedData.parentId],
      });
      if (parentCheck.rows.length === 0) {
        res.status(404).json({ success: false, message: "Parent comment not found" });
        return;
      }
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    const result = await connection.query<{
      id: string;
      projectId: string;
      userId: string;
      content: string;
      parentId: string | null;
      createdAt: string;
      updatedAt: string;
    }>({
      text: `
        INSERT INTO project_comments (id, project_id, user_id, content, parent_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING
          id,
          project_id  AS "projectId",
          user_id     AS "userId",
          content,
          parent_id   AS "parentId",
          created_at  AS "createdAt",
          updated_at  AS "updatedAt"
      `,
      values: [
        id,
        validatedData.projectId,
        req.user.id,
        validatedData.content,
        validatedData.parentId ?? null,
        now,
        now,
      ],
    });

    if (result.rows.length === 0) {
      res.status(500).json({ success: false, message: "Failed to create comment" });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Comment created successfully",
      data: result.rows[0],
    });

    const organizationId = req.user.organizationId;
    if (organizationId) {
      notifyProjectComment({
        commentId: id,
        projectId: validatedData.projectId,
        projectName,
        content: validatedData.content,
        parentId: validatedData.parentId ?? null,
        actor: { id: req.user.id, name: req.user.name },
        organizationId,
      }).catch((err) => logger.error("Background comment notification failed:", err));

      if (validatedData.mentions && validatedData.mentions.length > 0) {
        notifyCommentMentions({
          commentId: id,
          projectId: validatedData.projectId,
          taskId: validatedData.taskId ?? null,
          mentions: validatedData.mentions,
          actor: { id: req.user.id, name: req.user.name },
          organizationId,
        }).catch((err) => logger.error("Background mention notification failed:", err));
      }
    }
  } catch (error: any) {
    logger.error("Error creating project comment:", {
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
