import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { invoices, projectExpenses, projects } from "@/schema/schema";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { resolveDateRange, previousRange, pctChange } from "@/utils/dateRange.util";

async function sumRevenue(orgId: string, from: Date, to: Date): Promise<number> {
  const [r] = await database
    .select({ total: sql<number>`COALESCE(SUM(CAST(${invoices.amount} AS DECIMAL)), 0)` })
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.status, "paid"), gte(invoices.datepaid, from), lte(invoices.datepaid, to)));
  return Number(r?.total ?? 0);
}

async function sumExpenses(orgId: string, from: Date, to: Date): Promise<number> {
  const [r] = await database
    .select({ total: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)` })
    .from(projectExpenses)
    .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
    .where(and(eq(projects.organizationId, orgId), gte(projectExpenses.date, from), lte(projectExpenses.date, to)));
  return Number(r?.total ?? 0);
}

export const getFinancialOverview = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.user as any;
    if (!organizationId) return res.status(400).json({ success: false, message: "Organization ID is required" });

    const range = resolveDateRange(req.query as any);
    const prev = previousRange(range);

    const [totalRevenue, totalExpenses, prevRevenue, prevExpenses] = await Promise.all([
      sumRevenue(organizationId, range.from, range.to),
      sumExpenses(organizationId, range.from, range.to),
      sumRevenue(organizationId, prev.from, prev.to),
      sumExpenses(organizationId, prev.from, prev.to),
    ]);

    // Monthly breakdown within range
    const monthlyRevenue = await database
      .select({
        month: sql<string>`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`,
        amount: sql<number>`SUM(CAST(${invoices.amount} AS DECIMAL))`,
      })
      .from(invoices)
      .where(and(eq(invoices.organizationId, organizationId), eq(invoices.status, "paid"), gte(invoices.datepaid, range.from), lte(invoices.datepaid, range.to)))
      .groupBy(sql`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`);

    const monthlyExpenses = await database
      .select({
        month: sql<string>`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`,
        amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`,
      })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(and(eq(projects.organizationId, organizationId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .groupBy(sql`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`);

    // Collect all unique months from both datasets
    const monthSet = new Set<string>();
    monthlyRevenue.forEach((r) => monthSet.add(r.month));
    monthlyExpenses.forEach((e) => monthSet.add(e.month));
    const months = Array.from(monthSet).sort();

    const timeline = months.map((m) => ({
      month: m,
      revenue: Number(monthlyRevenue.find((r) => r.month === m)?.amount ?? 0),
      expenses: Number(monthlyExpenses.find((e) => e.month === m)?.amount ?? 0),
    }));

    // Category breakdown within range
    const categoryBreakdown = await database
      .select({
        category: projectExpenses.category,
        amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`,
      })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(and(eq(projects.organizationId, organizationId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .groupBy(projectExpenses.category);

    // Project performance within range
    const projectPerformance = await database
      .select({
        id: projects.id,
        name: projects.name,
        budget: projects.budget,
        spent: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(projects)
      .leftJoin(projectExpenses, and(eq(projects.id, projectExpenses.projectId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(projects.id)
      .orderBy(desc(sql`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`))
      .limit(5);

    const netProfit = totalRevenue - totalExpenses;
    const prevProfit = prevRevenue - prevExpenses;

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalExpenses,
        netProfit,
        timeline,
        categoryBreakdown: categoryBreakdown.map((c) => ({ ...c, amount: Number(c.amount ?? 0) })),
        projectPerformance: projectPerformance.map((p) => ({ ...p, budget: Number(p.budget ?? 0), spent: Number(p.spent ?? 0) })),
        period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] },
        comparison: {
          previousRevenue: prevRevenue,
          previousExpenses: prevExpenses,
          previousProfit: prevProfit,
          revenueChange: pctChange(totalRevenue, prevRevenue),
          expensesChange: pctChange(totalExpenses, prevExpenses),
          profitChange: pctChange(netProfit, prevProfit),
        },
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error("Error fetching financial overview:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};
