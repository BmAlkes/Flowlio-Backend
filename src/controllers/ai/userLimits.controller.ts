import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { aiTokenLimits, aiUsageLogs, aiUsageAlerts, userOrganizations, users } from "@/schema/schema";
import { eq, and, isNull, gte, sql, inArray } from "drizzle-orm";

// ── GET /api/ai/user-limits ─────────────────────────────────────────────────

export const getUserLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as any;
    const orgId = user?.organizationId;
    const role = user?.role;

    if (!orgId || (role !== "user" && role !== "superadmin" && role !== "subadmin")) {
      res.status(403).json({ success: false, message: "Org admin access required" });
      return;
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // Get all active users in the org
    const orgUsers = await database
      .select({
        userId: userOrganizations.userId,
        role: userOrganizations.role,
      })
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.organizationId, orgId),
          eq(userOrganizations.status, "active")
        )
      );

    const userIds = orgUsers.map((u) => u.userId);
    if (userIds.length === 0) {
      res.status(200).json({ success: true, data: [] });
      return;
    }

    // Get user details
    const userDetails = await database
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));

    // Get per-user limits from aiTokenLimits
    const userLimits = await database
      .select({
        userId: aiTokenLimits.userId,
        tokenLimit: aiTokenLimits.tokenLimit,
      })
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          isNull(aiTokenLimits.feature),
          eq(aiTokenLimits.isActive, true)
        )
      );

    // Only user-level limits (userId is not null)
    const userLimitMap = new Map(
      userLimits
        .filter((l) => l.userId !== null)
        .map((l) => [l.userId, l.tokenLimit])
    );

    // Get per-user token usage this month
    const usageRows = await database
      .select({
        userId: aiUsageLogs.userId,
        totalTokens: sql<number>`coalesce(sum(${aiUsageLogs.totalTokens}), 0)`,
      })
      .from(aiUsageLogs)
      .where(
        and(
          eq(aiUsageLogs.organizationId, orgId),
          eq(aiUsageLogs.status, "success"),
          gte(aiUsageLogs.createdAt, monthStart)
        )
      )
      .groupBy(aiUsageLogs.userId);

    const usageMap = new Map(usageRows.map((r) => [r.userId, Number(r.totalTokens)]));

    const data = userDetails.map((u) => ({
      userId: u.id,
      userName: u.name,
      userEmail: u.email,
      monthlyLimit: userLimitMap.get(u.id) ?? null,
      tokensUsedThisMonth: usageMap.get(u.id) ?? 0,
    }));

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch user limits" });
  }
};

// ── PUT /api/ai/user-limits ─────────────────────────────────────────────────

export const setUserLimit = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as any;
    const orgId = user?.organizationId;
    const role = user?.role;

    if (!orgId || (role !== "user" && role !== "superadmin" && role !== "subadmin")) {
      res.status(403).json({ success: false, message: "Org admin access required" });
      return;
    }

    const { userId, monthlyLimit } = req.body;
    if (!userId) {
      res.status(400).json({ success: false, message: "userId is required" });
      return;
    }

    const now = new Date();

    // Remove limit: monthlyLimit === 0 or null
    if (!monthlyLimit || monthlyLimit <= 0) {
      await database
        .delete(aiTokenLimits)
        .where(
          and(
            eq(aiTokenLimits.organizationId, orgId),
            eq(aiTokenLimits.userId, userId),
            isNull(aiTokenLimits.feature)
          )
        );

      res.status(200).json({ success: true, message: "User limit removed" });
      return;
    }

    // Upsert user limit
    const [existing] = await database
      .select({ id: aiTokenLimits.id })
      .from(aiTokenLimits)
      .where(
        and(
          eq(aiTokenLimits.organizationId, orgId),
          eq(aiTokenLimits.userId, userId),
          isNull(aiTokenLimits.feature)
        )
      )
      .limit(1);

    if (existing) {
      await database
        .update(aiTokenLimits)
        .set({ tokenLimit: monthlyLimit, updatedAt: now })
        .where(eq(aiTokenLimits.id, existing.id));
    } else {
      await database.insert(aiTokenLimits).values({
        organizationId: orgId,
        userId,
        feature: null,
        tokenLimit: monthlyLimit,
        tokensUsed: 0,
        period: "monthly",
        alertThresholdPercent: 80,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    res.status(200).json({
      success: true,
      message: `User limit set to ${monthlyLimit.toLocaleString()} tokens/month`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to set user limit" });
  }
};

// ── POST /api/ai/alerts/dismiss ─────────────────────────────────────────────

export const dismissAlerts = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as any;
    const orgId = user?.organizationId;
    if (!orgId) {
      res.status(400).json({ success: false, message: "Organization required" });
      return;
    }

    const { alertIds } = req.body as { alertIds?: string[] };
    if (!alertIds || !Array.isArray(alertIds) || alertIds.length === 0) {
      res.status(400).json({ success: false, message: "alertIds array is required" });
      return;
    }

    await database
      .update(aiUsageAlerts)
      .set({ isRead: true })
      .where(
        and(
          eq(aiUsageAlerts.organizationId, orgId),
          inArray(aiUsageAlerts.id, alertIds)
        )
      );

    res.status(200).json({ success: true, message: "Alerts dismissed" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to dismiss alerts" });
  }
};
