import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projects, projectComments, users } from "@/schema/schema";
import { and, eq, isNull, inArray, desc, asc, count } from "drizzle-orm";
import { commentReadScope } from "@/security/resource-access";
import { logger } from "@/utils/logger.util";

export const getAllOrgComments = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res
        .status(401)
        .json({ success: false, message: "Authentication required" });
      return;
    }
    if (!req.user.organizationId) {
      res
        .status(403)
        .json({ success: false, message: "Organization context required" });
      return;
    }
    const page = Math.max(
      1,
      Number.parseInt(String(req.query.page ?? "1"), 10) || 1,
    );
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(String(req.query.limit ?? "20"), 10) || 20),
    );
    const scope = commentReadScope(req.user);
    const conditions = and(
      scope,
      isNull(projectComments.parentId),
      typeof req.query.projectId === "string"
        ? eq(projectComments.projectId, req.query.projectId)
        : undefined,
    );
    const [totalRow] = await database
      .select({ total: count() })
      .from(projectComments)
      .where(conditions);
    const total = totalRow?.total ?? 0;
    const selection = {
      id: projectComments.id,
      projectId: projectComments.projectId,
      projectName: projects.name,
      parentId: projectComments.parentId,
      userId: projectComments.userId,
      userName: users.name,
      content: projectComments.content,
      createdAt: projectComments.createdAt,
      updatedAt: projectComments.updatedAt,
    };
    const topLevel = await database
      .select(selection)
      .from(projectComments)
      .leftJoin(projects, eq(projectComments.projectId, projects.id))
      .leftJoin(users, eq(projectComments.userId, users.id))
      .where(conditions)
      .orderBy(desc(projectComments.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const replies = topLevel.length
      ? await database
          .select(selection)
          .from(projectComments)
          .leftJoin(projects, eq(projectComments.projectId, projects.id))
          .leftJoin(users, eq(projectComments.userId, users.id))
          .where(
            and(
              scope,
              inArray(
                projectComments.parentId,
                topLevel.map((comment) => comment.id),
              ),
            ),
          )
          .orderBy(asc(projectComments.createdAt))
      : [];
    res
      .status(200)
      .json({
        success: true,
        message: "Comments retrieved successfully",
        data: topLevel.map((comment) => ({
          ...comment,
          replies: replies.filter(
            (reply) =>
              reply.parentId === comment.id &&
              reply.projectId === comment.projectId,
          ),
        })),
        total,
        page,
        totalPages: Math.ceil(total / limit),
      });
  } catch (error) {
    logger.error("Error retrieving organization comments", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
