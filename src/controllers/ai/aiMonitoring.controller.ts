import { Response } from "express";
import { database } from "@/configs/connection.config";
import {
  aiUsageLogs,
  aiTokenLimits,
  aiUsageAlerts,
  auditLogs,
  organizations,
} from "@/schema/schema";
import { eq, and, gte, isNull, sql, or, desc } from "drizzle-orm";

// ==================== GET /api/ai/usage ====================

export const getUsage = async (req: any, res: Response): Promise<void> => {
  try {
    const orgId = (
      req.user?.isSuperAdmin === true || !req.user?.organizationId
        ? (req.query.orgId as string)
        : req.user?.organizationId
    ) as string | undefined;

    if (!orgId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Run all five queries in parallel
    const [
      monthAggRows,
      featureBreakdown,
      dailyUsage,
      limitRecords,
      unreadAlerts,
    ] = await Promise.all([
      // Query 1 — current month aggregates
      database
        .select({
          totalTokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
          promptTokens: sql<number>`coalesce(sum(${aiUsageLogs.promptTokens}), 0)`,
          completionTokens: sql<number>`coalesce(sum(${aiUsageLogs.completionTokens}), 0)`,
          totalRequests: sql<number>`count(*)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            eq(aiUsageLogs.organizationId, orgId),
            eq(aiUsageLogs.status, "success"),
            gte(aiUsageLogs.createdAt, monthStart)
          )
        ),

      // Query 2 — per-feature breakdown
      database
        .select({
          feature: aiUsageLogs.feature,
          tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
          requests: sql<number>`count(*)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            eq(aiUsageLogs.organizationId, orgId),
            eq(aiUsageLogs.status, "success"),
            gte(aiUsageLogs.createdAt, monthStart)
          )
        )
        .groupBy(aiUsageLogs.feature),

      // Query 3 — last 7 days daily usage
      database
        .select({
          date: sql<string>`date(${aiUsageLogs.createdAt})`,
          tokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
          requests: sql<number>`count(*)`,
        })
        .from(aiUsageLogs)
        .where(
          and(
            eq(aiUsageLogs.organizationId, orgId),
            eq(aiUsageLogs.status, "success"),
            gte(aiUsageLogs.createdAt, sevenDaysAgo)
          )
        )
        .groupBy(sql`date(${aiUsageLogs.createdAt})`)
        .orderBy(sql`date(${aiUsageLogs.createdAt})`),

      // Query 4 — current org limit
      database
        .select()
        .from(aiTokenLimits)
        .where(
          and(
            eq(aiTokenLimits.organizationId, orgId),
            isNull(aiTokenLimits.userId),
            isNull(aiTokenLimits.feature),
            eq(aiTokenLimits.isActive, true)
          )
        )
        .limit(1),

      // Query 5 — unread alerts
      database
        .select()
        .from(aiUsageAlerts)
        .where(
          and(
            eq(aiUsageAlerts.organizationId, orgId),
            eq(aiUsageAlerts.isRead, false)
          )
        )
        .orderBy(desc(aiUsageAlerts.createdAt)),
    ]);

    const currentMonth = monthAggRows[0] ?? {
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalRequests: 0,
    };

    const limit = limitRecords[0] ?? null;

    const usagePercent =
      limit && limit.tokenLimit > 0
        ? Number(
            (
              (Number(currentMonth.totalTokens) / limit.tokenLimit) *
              100
            ).toFixed(2)
          )
        : 0;

    res.status(200).json({
      currentMonth: {
        totalTokens: Number(currentMonth.totalTokens),
        promptTokens: Number(currentMonth.promptTokens),
        completionTokens: Number(currentMonth.completionTokens),
        totalRequests: Number(currentMonth.totalRequests),
      },
      limit,
      tokenLimit: limit,
      usagePercent,
      featureBreakdown: featureBreakdown.map((row) => ({
        feature: row.feature,
        tokens: Number(row.tokens),
        requests: Number(row.requests),
      })),
      dailyUsage: dailyUsage.map((row) => ({
        date: row.date,
        tokens: Number(row.tokens),
        requests: Number(row.requests),
      })),
      unreadAlerts,
    });
  } catch (error) {
    res.status(500).json({
      error: "Failed to fetch AI usage data",
    });
  }
};

// ==================== GET /api/ai/limits ====================

export const getLimits = async (req: any, res: Response): Promise<void> => {
  try {
    const orgId = (
      req.user?.isSuperAdmin === true || !req.user?.organizationId
        ? (req.query.orgId as string)
        : req.user?.organizationId
    ) as string | undefined;

    if (!orgId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    const records = await database
      .select()
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature),
          eq(aiTokenLimits.isActive, true)
        )
      )
      .limit(1);

    if (records.length === 0) {
      res.status(200).json({ limit: null, message: "No limit configured" });
      return;
    }

    res.status(200).json({ limit: records[0] });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch AI limits" });
  }
};

// ==================== GET /api/ai/limits/all ====================

const DEFAULT_TOKEN_LIMIT = 50_000;

export const getAllLimits = async (req: any, res: Response): Promise<void> => {
  try {
    const role = req.user?.role as string | undefined;

    if (role !== "superadmin" && role !== "subadmin") {
      res.status(403).json({ error: "Only admins can view AI limits" });
      return;
    }

    const monthStart = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    );

    // Start from organizations so that orgs WITHOUT a limit record are included.
    // The ai_token_limits join conditions (userId IS NULL, feature IS NULL) live
    // in the ON clause — moving them to WHERE would turn the LEFT JOIN into an
    // INNER JOIN and drop orgs with no limit record.
    const rows = await database
      .select({
        id: aiTokenLimits.id,
        organizationId: organizations.id,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
        isDemo: sql<boolean>`coalesce((${organizations.settings}->>'demo')::boolean, false)`,
        tokenLimit: sql<number>`coalesce(${aiTokenLimits.tokenLimit}, ${DEFAULT_TOKEN_LIMIT})`,
        tokensUsed: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
        totalRequests: sql<number>`count(${aiUsageLogs.id})`,
        alertThresholdPercent: sql<number>`coalesce(${aiTokenLimits.alertThresholdPercent}, 80)`,
        period: sql<string>`coalesce(${aiTokenLimits.period}, 'monthly')`,
        isActive: sql<boolean>`coalesce(${aiTokenLimits.isActive}, false)`,
        isDefault: sql<boolean>`(${aiTokenLimits.id} is null)`,
      })
      .from(organizations)
      .leftJoin(
        aiTokenLimits,
        and(
          eq(aiTokenLimits.organizationId, organizations.id),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature)
        )
      )
      .leftJoin(
        aiUsageLogs,
        and(
          eq(aiUsageLogs.organizationId, organizations.id),
          eq(aiUsageLogs.status, "success"),
          gte(aiUsageLogs.createdAt, monthStart)
        )
      )
      .where(
        // Include orgs with status='active' AND legacy orgs where status is NULL
        // (status.$defaultFn only applies at JS insert time, not as a DB DEFAULT,
        //  so older rows can have status=NULL)
        // Exclude only explicitly suspended/inactive orgs.
        or(
          eq(organizations.status, "active"),
          isNull(organizations.status)
        )
      )
      .groupBy(
        // organizations.id is the PK — PostgreSQL allows all other organizations.*
        // columns in SELECT without repeating them here (functional dependency).
        // Critically: organizations.settings is json type (not jsonb), so it has
        // no equality operator and CANNOT appear in GROUP BY.
        organizations.id,
        organizations.name,
        organizations.slug,
        aiTokenLimits.id,
        aiTokenLimits.tokenLimit,
        aiTokenLimits.alertThresholdPercent,
        aiTokenLimits.period,
        aiTokenLimits.isActive
      )
      .orderBy(sql`coalesce(sum(${aiUsageLogs.totalTokens}), 0) desc`);

    res.status(200).json({
      data: rows.map((row) => {
        const tokensUsed = Number(row.tokensUsed);
        const tokenLimit = Number(row.tokenLimit);
        return {
          ...row,
          tokensUsed,
          totalRequests: Number(row.totalRequests),
          usagePercent:
            tokenLimit > 0 ? Math.round((tokensUsed / tokenLimit) * 100) : 0,
        };
      }),
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch AI limits" });
  }
};

// ==================== PUT /api/ai/limits ====================

export const setLimits = async (req: any, res: Response): Promise<void> => {
  try {
    const role = req.user?.role as string | undefined;

    if (role !== "superadmin" && role !== "subadmin") {
      res
        .status(403)
        .json({ error: "Only admins can configure AI limits" });
      return;
    }

    const { orgId, tokenLimit, alertThresholdPercent = 80 } = req.body;

    if (!orgId || typeof orgId !== "string") {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    if (!tokenLimit || !Number.isInteger(tokenLimit) || tokenLimit <= 0) {
      res
        .status(400)
        .json({ error: "tokenLimit must be a positive integer" });
      return;
    }

    // Check if an org-wide limit record already exists
    const existing = await database
      .select()
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature)
        )
      )
      .limit(1);

    let upserted;

    if (existing.length > 0) {
      // UPDATE existing record
      const [updated] = await database
        .update(aiTokenLimits)
        .set({
          tokenLimit,
          alertThresholdPercent,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiTokenLimits.organizationId, orgId),
            isNull(aiTokenLimits.userId),
            isNull(aiTokenLimits.feature)
          )
        )
        .returning();
      upserted = updated;
    } else {
      // INSERT new record
      const [inserted] = await database
        .insert(aiTokenLimits)
        .values({
          organizationId: orgId,
          userId: null,
          feature: null,
          tokenLimit,
          alertThresholdPercent,
          period: "monthly",
          isActive: true,
          tokensUsed: 0,
        })
        .returning();
      upserted = inserted;
    }

    res.status(200).json(upserted);
  } catch (error) {
    res.status(500).json({ error: "Failed to set AI limits" });
  }
};

// ==================== DELETE /api/ai/limits/:orgId ====================

export const removeLimits = async (req: any, res: Response): Promise<void> => {
  try {
    const role = req.user?.role as string | undefined;

    if (role !== "superadmin" && role !== "subadmin") {
      res.status(403).json({ error: "Only admins can remove AI limits" });
      return;
    }

    const orgId = req.params.orgId as string | undefined;

    if (!orgId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    const [removed] = await database
      .update(aiTokenLimits)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.userId),
          isNull(aiTokenLimits.feature),
          eq(aiTokenLimits.isActive, true)
        )
      )
      .returning();

    if (!removed) {
      res.status(404).json({ error: "AI limit not found" });
      return;
    }

    res.status(200).json({ message: "AI limit removed successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove AI limits" });
  }
};

// ==================== GET /api/ai/audit ====================

export const getAudit = async (req: any, res: Response): Promise<void> => {
  try {
    const role = req.user?.role as string | undefined;

    if (role !== "superadmin" && role !== "subadmin") {
      res.status(403).json({ error: "Only admins can view audit logs" });
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const [data, countRows] = await Promise.all([
      // Fetch paginated records
      database
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resource, "ai"))
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),

      // Count total matching records
      database
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(eq(auditLogs.resource, "ai")),
    ]);

    const total = Number(countRows[0]?.count ?? 0);

    res.status(200).json({ data, total, page, limit });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
};
