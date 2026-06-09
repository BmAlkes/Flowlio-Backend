import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { clientInteractions, clients, users } from "@/schema/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { requireOrganizationId } from "@/utils/organization.util";

export const getOrgInteractions = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || "20", 10)));
    const offset = (page - 1) * limit;

    // Count total for pagination
    const totalResult = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(clientInteractions)
      .where(and(eq(clientInteractions.organizationId, organizationId), eq(clientInteractions.type, "note")));

    const total = totalResult[0]?.count ?? 0;
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      res.status(status.OK).json({ success: true, data: [], total: 0, page, totalPages: 0 });
      return;
    }

    // clients.name and users.name share the column "name" — use sql.as() to force SQL aliases
    const rows = await database
      .select({
        id: clientInteractions.id,
        clientId: clientInteractions.clientId,
        clientName: sql<string | null>`${clients.name}`.as("client_name"),
        userId: clientInteractions.userId,
        userName: sql<string | null>`${users.name}`.as("user_name"),
        content: clientInteractions.content,
        type: clientInteractions.type,
        createdAt: clientInteractions.createdAt,
      })
      .from(clientInteractions)
      .leftJoin(clients, eq(clientInteractions.clientId, clients.id))
      .leftJoin(users, eq(clientInteractions.userId, users.id))
      .where(and(eq(clientInteractions.organizationId, organizationId), eq(clientInteractions.type, "note")))
      .orderBy(desc(clientInteractions.createdAt))
      .limit(limit)
      .offset(offset);

    const data = rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.clientName ?? null,
      userId: r.userId,
      userName: r.userName ?? null,
      content: r.content,
      type: r.type,
      createdAt: r.createdAt,
    }));

    res.status(status.OK).json({
      success: true,
      data,
      total,
      page,
      totalPages,
    });
  } catch (error) {
    logger.error("Error fetching org interactions:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
