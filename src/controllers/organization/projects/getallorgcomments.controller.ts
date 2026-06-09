import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { database } from "@/configs/connection.config";
import { projects } from "../../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

export const getAllOrgComments = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "User not authenticated" });
      return;
    }

    const organizationId = req.user.organizationId;
    if (!organizationId) {
      res.status(200).json({ success: true, message: "No organization found", data: [], total: 0, page: 1, totalPages: 0 });
      return;
    }

    const projectId = req.query.projectId as string | undefined;
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
    const offset = (page - 1) * limit;

    // Resolve project IDs that belong to this org
    let projectIds: string[];
    if (projectId) {
      const proj = await database
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
        .limit(1);

      if (proj.length === 0) {
        res.status(200).json({ success: true, message: "No comments found", data: [], total: 0, page, totalPages: 0 });
        return;
      }
      projectIds = [projectId];
    } else {
      const orgProjects = await database
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));

      if (orgProjects.length === 0) {
        res.status(200).json({ success: true, message: "No comments found", data: [], total: 0, page, totalPages: 0 });
        return;
      }
      projectIds = orgProjects.map((p) => p.id);
    }

    // Build $1, $2, ... placeholders for the IN clause
    const inPlaceholders = projectIds.map((_, i) => `$${i + 1}`).join(", ");

    // COUNT top-level comments
    const countResult = await connection.query({
      text: `SELECT count(*)::int AS total FROM project_comments WHERE project_id IN (${inPlaceholders}) AND parent_id IS NULL`,
      values: projectIds,
    });
    const total: number = parseInt(countResult.rows[0]?.total ?? "0", 10);
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      res.status(200).json({ success: true, message: "No comments found", data: [], total: 0, page, totalPages: 0 });
      return;
    }

    // Fetch top-level comments with JOINs for project, user, task — all in one query
    const limitIdx  = projectIds.length + 1;
    const offsetIdx = projectIds.length + 2;

    const mainResult = await connection.query<{
      id: string;
      projectId: string;
      projectName: string | null;
      taskId: string | null;
      taskTitle: string | null;
      parentId: string | null;
      userId: string;
      userName: string | null;
      content: string;
      createdAt: string;
      updatedAt: string;
    }>({
      text: `
        SELECT
          pc.id,
          pc.project_id      AS "projectId",
          p.name             AS "projectName",
          pc."taskId"        AS "taskId",
          t.title            AS "taskTitle",
          pc.parent_id       AS "parentId",
          pc.user_id         AS "userId",
          u.name             AS "userName",
          pc.content,
          pc.created_at      AS "createdAt",
          pc.updated_at      AS "updatedAt"
        FROM project_comments pc
        LEFT JOIN projects p ON pc.project_id = p.id
        LEFT JOIN users    u ON pc.user_id    = u.id
        LEFT JOIN tasks    t ON pc."taskId"   = t.id
        WHERE pc.project_id IN (${inPlaceholders})
          AND pc.parent_id IS NULL
        ORDER BY pc.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      values: [...projectIds, limit, offset],
    });

    const topLevel = mainResult.rows;

    if (topLevel.length === 0) {
      res.status(200).json({ success: true, message: "No comments found", data: [], total, page, totalPages });
      return;
    }

    // Fetch replies for these top-level comments
    const topLevelIds = topLevel.map((c) => c.id);
    const replyPlaceholders = topLevelIds.map((_, i) => `$${i + 1}`).join(", ");

    const replyResult = await connection.query<{
      id: string;
      projectId: string;
      taskId: string | null;
      parentId: string;
      userId: string;
      userName: string | null;
      content: string;
      createdAt: string;
      updatedAt: string;
    }>({
      text: `
        SELECT
          pc.id,
          pc.project_id  AS "projectId",
          pc."taskId"    AS "taskId",
          pc.parent_id   AS "parentId",
          pc.user_id     AS "userId",
          u.name         AS "userName",
          pc.content,
          pc.created_at  AS "createdAt",
          pc.updated_at  AS "updatedAt"
        FROM project_comments pc
        LEFT JOIN users u ON pc.user_id = u.id
        WHERE pc.parent_id IN (${replyPlaceholders})
        ORDER BY pc.created_at ASC
      `,
      values: topLevelIds,
    });

    const repliesByParent = new Map<string, typeof replyResult.rows>();
    replyResult.rows.forEach((r) => {
      const bucket = repliesByParent.get(r.parentId) ?? [];
      bucket.push(r);
      repliesByParent.set(r.parentId, bucket);
    });

    const data = topLevel.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      projectName: c.projectName ?? null,
      taskId: c.taskId ?? null,
      taskTitle: c.taskTitle ?? null,
      parentId: c.parentId ?? null,
      userId: c.userId,
      userName: c.userName ?? null,
      content: c.content,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      replies: (repliesByParent.get(c.id) ?? []).map((r) => ({
        id: r.id,
        projectId: r.projectId,
        taskId: r.taskId ?? null,
        parentId: r.parentId,
        userId: r.userId,
        userName: r.userName ?? null,
        content: r.content,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    }));

    res.status(200).json({
      success: true,
      message: "Comments retrieved successfully",
      data,
      total,
      page,
      totalPages,
    });
  } catch (error: any) {
    logger.error("Error retrieving org comments:", {
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
