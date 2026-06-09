import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
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

    // COUNT
    const countResult = await connection.query({
      text: `SELECT count(*)::int AS total FROM client_interactions WHERE organization_id = $1 AND type = 'note'`,
      values: [organizationId],
    });
    const total: number = parseInt(countResult.rows[0]?.total ?? "0", 10);
    const totalPages = Math.ceil(total / limit);

    if (total === 0) {
      res.status(status.OK).json({ success: true, data: [], total: 0, page, totalPages: 0 });
      return;
    }

    // Main query — clients.name and users.name aliased explicitly in SQL
    const result = await connection.query<{
      id: string;
      clientId: string;
      clientName: string | null;
      userId: string;
      userName: string | null;
      content: string;
      type: string;
      createdAt: string;
    }>({
      text: `
        SELECT
          ci.id,
          ci.client_id   AS "clientId",
          c.name         AS "clientName",
          ci.user_id     AS "userId",
          u.name         AS "userName",
          ci.content,
          ci.type,
          ci.created_at  AS "createdAt"
        FROM client_interactions ci
        LEFT JOIN clients c ON ci.client_id = c.id
        LEFT JOIN users   u ON ci.user_id   = u.id
        WHERE ci.organization_id = $1 AND ci.type = 'note'
        ORDER BY ci.created_at DESC
        LIMIT $2 OFFSET $3
      `,
      values: [organizationId, limit, offset],
    });

    const data = result.rows.map((r) => ({
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
  } catch (error: any) {
    logger.error("Error fetching org interactions:", {
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
