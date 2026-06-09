import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectComments, projects, tasks, users } from "../../../../drizzle/schema";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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

    // Resolve which project IDs belong to this org
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

    // Count total top-level comments for pagination
    const totalResult = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(projectComments)
      .where(and(inArray(projectComments.projectId, projectIds), isNull(projectComments.parentId)));

    const total = totalResult[0]?.count ?? 0;
    const totalPages = Math.ceil(total / limit);

    // Fetch top-level comments (paginated) with user + project name
    // NOTE: projects.name and users.name share the column name "name" — must use
    // sql``.as() to force SQL-level aliases, otherwise the pg driver collapses them.
    const topLevel = await database
      .select({
        id: projectComments.id,
        projectId: projectComments.projectId,
        projectName: sql<string | null>`${projects.name}`.as("project_name"),
        taskId: projectComments.taskId,
        parentId: projectComments.parentId,
        userId: projectComments.userId,
        userName: sql<string | null>`${users.name}`.as("user_name"),
        content: projectComments.content,
        createdAt: projectComments.createdAt,
        updatedAt: projectComments.updatedAt,
      })
      .from(projectComments)
      .leftJoin(projects, eq(projectComments.projectId, projects.id))
      .leftJoin(users, eq(projectComments.userId, users.id))
      .where(and(inArray(projectComments.projectId, projectIds), isNull(projectComments.parentId)))
      .orderBy(desc(projectComments.createdAt))
      .limit(limit)
      .offset(offset);

    if (topLevel.length === 0) {
      res.status(200).json({ success: true, message: "No comments found", data: [], total, page, totalPages });
      return;
    }

    // Resolve task titles for comments that have a taskId
    const taskIds = [...new Set(topLevel.map((c) => c.taskId).filter(Boolean) as string[])];
    const taskTitleMap = new Map<string, string>();
    if (taskIds.length > 0) {
      const taskRows = await database
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(inArray(tasks.id, taskIds));
      taskRows.forEach((t) => taskTitleMap.set(t.id, t.title));
    }

    // Fetch all replies for these top-level comments in one query
    const topLevelIds = topLevel.map((c) => c.id);
    const replyRows = await database
      .select({
        id: projectComments.id,
        projectId: projectComments.projectId,
        taskId: projectComments.taskId,
        parentId: projectComments.parentId,
        userId: projectComments.userId,
        userName: sql<string | null>`${users.name}`.as("user_name"),
        content: projectComments.content,
        createdAt: projectComments.createdAt,
        updatedAt: projectComments.updatedAt,
      })
      .from(projectComments)
      .leftJoin(users, eq(projectComments.userId, users.id))
      .where(inArray(projectComments.parentId, topLevelIds))
      .orderBy(projectComments.createdAt);

    const repliesByParent = new Map<string, typeof replyRows>();
    replyRows.forEach((r) => {
      const bucket = repliesByParent.get(r.parentId!) ?? [];
      bucket.push(r);
      repliesByParent.set(r.parentId!, bucket);
    });

    const comments = topLevel.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      projectName: c.projectName ?? null,
      taskId: c.taskId ?? null,
      taskTitle: c.taskId ? (taskTitleMap.get(c.taskId) ?? null) : null,
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
        parentId: r.parentId ?? null,
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
      data: comments,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    logger.error("Error retrieving org comments:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
