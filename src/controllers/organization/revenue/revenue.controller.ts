import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { revenueEntries } from "@/schema/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import { resolveDateRange } from "@/utils/dateRange.util";
import { logger } from "@/utils/logger.util";

const VALID_CATEGORIES = ["service", "product", "retainer", "consulting", "other"] as const;
const VALID_SOURCES = ["manual", "invoice", "stripe", "paypal", "bank_transfer"] as const;

// ── GET /api/revenue ─────────────────────────────────────────────────────────

export const getRevenue = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const range = resolveDateRange(req.query as any);
    const { category, source, clientId, page: pageStr = "1", limit: limitStr = "50" } = req.query as Record<string, string>;

    const page = Math.max(1, parseInt(pageStr));
    const limit = Math.min(200, Math.max(1, parseInt(limitStr)));
    const offset = (page - 1) * limit;
    const fromStr = range.from.toISOString().split("T")[0];
    const toStr = range.to.toISOString().split("T")[0];

    const conditions: any[] = [
      eq(revenueEntries.organizationId, organizationId),
      sql`${revenueEntries.date}::date >= ${fromStr}::date`,
      sql`${revenueEntries.date}::date <= ${toStr}::date`,
    ];

    if (category) conditions.push(eq(revenueEntries.category, category));
    if (source) conditions.push(eq(revenueEntries.source, source));
    if (clientId) conditions.push(eq(revenueEntries.clientId, clientId));

    const where = and(...conditions);

    const [entries, [countRow], byCat, bySrc, byMonth] = await Promise.all([
      database
        .select()
        .from(revenueEntries)
        .where(where)
        .orderBy(desc(sql`${revenueEntries.date}::date`))
        .limit(limit)
        .offset(offset),

      database
        .select({ count: sql<number>`COUNT(*)` })
        .from(revenueEntries)
        .where(where),

      database
        .select({ category: revenueEntries.category, amount: sql<number>`SUM(CAST(${revenueEntries.amount} AS DECIMAL))` })
        .from(revenueEntries)
        .where(where)
        .groupBy(revenueEntries.category),

      database
        .select({ source: revenueEntries.source, amount: sql<number>`SUM(CAST(${revenueEntries.amount} AS DECIMAL))` })
        .from(revenueEntries)
        .where(where)
        .groupBy(revenueEntries.source),

      database
        .select({
          month: sql<string>`TO_CHAR(${revenueEntries.date}::date, 'YYYY-MM')`,
          amount: sql<number>`SUM(CAST(${revenueEntries.amount} AS DECIMAL))`,
        })
        .from(revenueEntries)
        .where(where)
        .groupBy(sql`TO_CHAR(${revenueEntries.date}::date, 'YYYY-MM')`)
        .orderBy(sql`TO_CHAR(${revenueEntries.date}::date, 'YYYY-MM')`),
    ]);

    const total = Number(countRow?.count ?? 0);
    const totalAmount = byCat.reduce((s, r) => s + Number(r.amount ?? 0), 0);

    res.status(200).json({
      success: true,
      data: {
        entries: entries.map((e) => ({ ...e, amount: Number(e.amount) })),
        summary: {
          total: totalAmount,
          byCategory: byCat.map((r) => ({ category: r.category, amount: Number(r.amount ?? 0) })),
          bySource: bySrc.map((r) => ({ source: r.source, amount: Number(r.amount ?? 0) })),
          byMonth: byMonth.map((r) => ({ month: r.month, amount: Number(r.amount ?? 0) })),
        },
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    logger.error("getRevenue error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch revenue" });
  }
};

// ── POST /api/revenue ────────────────────────────────────────────────────────

export const createRevenueEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { date, amount, currency = "USD", category = "service", source = "manual", description, clientId, projectId } = req.body;

    if (!date || !amount) {
      res.status(400).json({ success: false, message: "date and amount are required" });
      return;
    }

    if (!VALID_CATEGORIES.includes(category)) {
      res.status(400).json({ success: false, message: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
      return;
    }

    if (!VALID_SOURCES.includes(source)) {
      res.status(400).json({ success: false, message: `source must be one of: ${VALID_SOURCES.join(", ")}` });
      return;
    }

    const createdBy = (req as any).user?.id;
    const now = new Date();

    const [entry] = await database
      .insert(revenueEntries)
      .values({
        organizationId,
        date,
        amount: Number(amount).toFixed(2),
        currency,
        category,
        source,
        description: description ?? null,
        clientId: clientId ?? null,
        projectId: projectId ?? null,
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json({ success: true, data: { ...entry, amount: Number(entry.amount) } });
  } catch (error) {
    logger.error("createRevenueEntry error:", error);
    res.status(500).json({ success: false, message: "Failed to create revenue entry" });
  }
};

// ── PUT /api/revenue/:entryId ────────────────────────────────────────────────

export const updateRevenueEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { entryId } = req.params;

    const [existing] = await database
      .select({ id: revenueEntries.id, source: revenueEntries.source })
      .from(revenueEntries)
      .where(and(eq(revenueEntries.id, entryId), eq(revenueEntries.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ success: false, message: "Revenue entry not found" });
      return;
    }

    if (existing.source === "invoice") {
      res.status(400).json({ success: false, message: "Invoice-synced entries cannot be edited here. Edit the invoice instead." });
      return;
    }

    const { date, amount, currency, category, source, description, clientId, projectId } = req.body;
    const updates: any = { updatedAt: new Date() };

    if (date !== undefined) updates.date = date;
    if (amount !== undefined) updates.amount = Number(amount).toFixed(2);
    if (currency !== undefined) updates.currency = currency;
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) { res.status(400).json({ success: false, message: "Invalid category" }); return; }
      updates.category = category;
    }
    if (source !== undefined) {
      if (!VALID_SOURCES.includes(source)) { res.status(400).json({ success: false, message: "Invalid source" }); return; }
      updates.source = source;
    }
    if (description !== undefined) updates.description = description;
    if (clientId !== undefined) updates.clientId = clientId ?? null;
    if (projectId !== undefined) updates.projectId = projectId ?? null;

    const [updated] = await database
      .update(revenueEntries)
      .set(updates)
      .where(eq(revenueEntries.id, entryId))
      .returning();

    res.status(200).json({ success: true, data: { ...updated, amount: Number(updated.amount) } });
  } catch (error) {
    logger.error("updateRevenueEntry error:", error);
    res.status(500).json({ success: false, message: "Failed to update revenue entry" });
  }
};

// ── DELETE /api/revenue/:entryId ─────────────────────────────────────────────

export const deleteRevenueEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { entryId } = req.params;

    const [existing] = await database
      .select({ id: revenueEntries.id, source: revenueEntries.source })
      .from(revenueEntries)
      .where(and(eq(revenueEntries.id, entryId), eq(revenueEntries.organizationId, organizationId)))
      .limit(1);

    if (!existing) {
      res.status(404).json({ success: false, message: "Revenue entry not found" });
      return;
    }

    if (existing.source === "invoice") {
      res.status(400).json({ success: false, message: "Invoice-synced entries cannot be deleted here. Mark the invoice as unpaid instead." });
      return;
    }

    await database.delete(revenueEntries).where(eq(revenueEntries.id, entryId));
    res.status(200).json({ success: true, message: "Revenue entry deleted" });
  } catch (error) {
    logger.error("deleteRevenueEntry error:", error);
    res.status(500).json({ success: false, message: "Failed to delete revenue entry" });
  }
};
