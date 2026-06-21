import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { aiUsageLogs } from "@/schema/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";

// ── GET /api/superadmin/ai/logs ─────────────────────────────────────────────

export const getSuperadminAILogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const role = (req as any).user?.role as string | undefined;
    if (role !== "superadmin" && role !== "subadmin") {
      res.status(403).json({ success: false, message: "Superadmin only" });
      return;
    }

    const {
      orgId,
      userId,
      feature,
      status,
      from,
      to,
      page: pageStr = "1",
      limit: limitStr = "50",
    } = req.query as Record<string, string | undefined>;

    const page = Math.max(1, parseInt(pageStr ?? "1"));
    const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? "50")));
    const offset = (page - 1) * limit;

    const conditions: any[] = [];
    if (orgId) conditions.push(eq(aiUsageLogs.organizationId, orgId));
    if (userId) conditions.push(eq(aiUsageLogs.userId, userId));
    if (feature) conditions.push(eq(aiUsageLogs.feature, feature));
    if (status) conditions.push(eq(aiUsageLogs.status, status));
    if (from) conditions.push(gte(aiUsageLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(aiUsageLogs.createdAt, new Date(to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [logs, [countRow], [summaryRow]] = await Promise.all([
      database
        .select()
        .from(aiUsageLogs)
        .where(where)
        .orderBy(desc(aiUsageLogs.createdAt))
        .limit(limit)
        .offset(offset),

      database
        .select({ count: sql<number>`count(*)` })
        .from(aiUsageLogs)
        .where(where),

      database
        .select({
          totalTokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
          totalRequests: sql<number>`count(*)`,
          avgDurationMs: sql<number>`coalesce(avg(${aiUsageLogs.durationMs}), 0)`,
          errorCount: sql<number>`count(*) filter (where ${aiUsageLogs.status} != 'success')`,
        })
        .from(aiUsageLogs)
        .where(where),
    ]);

    const total = Number(countRow?.count ?? 0);
    const totalRequests = Number(summaryRow?.totalRequests ?? 0);
    const errorCount = Number(summaryRow?.errorCount ?? 0);

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        summary: {
          totalTokens: Number(summaryRow?.totalTokens ?? 0),
          totalRequests,
          avgDurationMs: Math.round(Number(summaryRow?.avgDurationMs ?? 0)),
          errorRate: totalRequests > 0 ? Math.round((errorCount / totalRequests) * 100) : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch AI logs" });
  }
};

// ── GET /api/ai/my-usage-logs ───────────────────────────────────────────────

export const getMyUsageLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as any;
    const orgId = user?.organizationId;
    const userId = user?.id;

    if (!orgId || !userId) {
      res.status(400).json({ success: false, message: "Authenticated user required" });
      return;
    }

    const {
      feature,
      from,
      to,
      page: pageStr = "1",
      limit: limitStr = "50",
    } = req.query as Record<string, string | undefined>;

    const page = Math.max(1, parseInt(pageStr ?? "1"));
    const limit = Math.min(200, Math.max(1, parseInt(limitStr ?? "50")));
    const offset = (page - 1) * limit;

    const conditions: any[] = [
      eq(aiUsageLogs.organizationId, orgId),
      eq(aiUsageLogs.userId, userId),
    ];
    if (feature) conditions.push(eq(aiUsageLogs.feature, feature));
    if (from) conditions.push(gte(aiUsageLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(aiUsageLogs.createdAt, new Date(to)));

    const where = and(...conditions);

    const [logs, [countRow]] = await Promise.all([
      database
        .select()
        .from(aiUsageLogs)
        .where(where)
        .orderBy(desc(aiUsageLogs.createdAt))
        .limit(limit)
        .offset(offset),

      database
        .select({ count: sql<number>`count(*)` })
        .from(aiUsageLogs)
        .where(where),
    ]);

    const total = Number(countRow?.count ?? 0);

    res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch usage logs" });
  }
};
