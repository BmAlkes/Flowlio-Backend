import {isCurrency} from '@/utils/financial-currency';
import { projectReadScope } from "@/security/resource-access";
import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { revenueEntries, projectExpenses, projects, organizations } from "@/schema/schema";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { resolveDateRange, previousRange, pctChange, getGranularity, DateRange } from "@/utils/dateRange.util";

async function sumRevenue(orgId: string, from: Date, to: Date): Promise<number> {
  const [r] = await database
    .select({ total: sql<number>`COALESCE(SUM(CAST(${revenueEntries.amount} AS DECIMAL)), 0)` })
    .from(revenueEntries)
    .where(and(
      eq(revenueEntries.organizationId, orgId),
      sql`${revenueEntries.date}::date >= ${from.toISOString().split("T")[0]}::date`,
      sql`${revenueEntries.date}::date <= ${to.toISOString().split("T")[0]}::date`,
    ));
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

function dateTruncExpr(col: any, granularity: "daily" | "weekly" | "monthly"): any {
  if (granularity === "daily") return sql`TO_CHAR(${col}, 'YYYY-MM-DD')`;
  if (granularity === "weekly") return sql`TO_CHAR(DATE_TRUNC('week', ${col}), 'YYYY-MM-DD')`;
  return sql`TO_CHAR(${col}, 'YYYY-MM')`;
}

async function buildTimeline(
  orgId: string,
  range: DateRange,
  granularity: "daily" | "weekly" | "monthly",
): Promise<Array<{ date: string; revenue: number; expenses: number }>> {
  const fromStr = range.from.toISOString().split("T")[0];
  const toStr = range.to.toISOString().split("T")[0];
  const truncRev = dateTruncExpr(sql`${revenueEntries.date}::date`, granularity);
  const truncExp = dateTruncExpr(projectExpenses.date, granularity);

  const [revRows, expRows] = await Promise.all([
    database
      .select({ date: truncRev, amount: sql<number>`SUM(CAST(${revenueEntries.amount} AS DECIMAL))` })
      .from(revenueEntries)
      .where(and(
        eq(revenueEntries.organizationId, orgId),
        sql`${revenueEntries.date}::date >= ${fromStr}::date`,
        sql`${revenueEntries.date}::date <= ${toStr}::date`,
      ))
      .groupBy(truncRev)
      .orderBy(truncRev),
    database
      .select({ date: truncExp, amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))` })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(and(eq(projects.organizationId, orgId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .groupBy(truncExp)
      .orderBy(truncExp),
  ]);

  const dateSet = new Set<string>();
  revRows.forEach((r) => r.date && dateSet.add(r.date));
  expRows.forEach((e) => e.date && dateSet.add(e.date));

  return Array.from(dateSet)
    .sort()
    .map((d) => ({
      date: d,
      revenue: Number(revRows.find((r) => r.date === d)?.amount ?? 0),
      expenses: Number(expRows.find((e) => e.date === d)?.amount ?? 0),
    }));
}

export const getFinancialOverview = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.user as any;
    if (!organizationId) return res.status(400).json({ success: false, message: "Organization ID is required" });

    const [org]=await database.select({settings:organizations.settings}).from(organizations).where(eq(organizations.id,organizationId));
    const currencyCode=org?.settings?.currency;
    if(!isCurrency(currencyCode))return res.status(400).json({success:false,code:'CURRENCY_REQUIRED',message:'Currency not configured'});
    const mismatches=await database.execute(sql`select 1 from revenue_entries where organization_id=${organizationId} and currency is distinct from ${currencyCode}
      union all select 1 from project_expenses e join projects p on p.id=e.project_id where p.organization_id=${organizationId} and p.currency_code is distinct from ${currencyCode} limit 1`);
    if(mismatches.rows.length)return res.status(422).json({success:false,code:'CURRENCY_MISMATCH',message:'Financial records have different or missing currencies. Reconcile currencies before generating a consolidated report.'});
    const range = resolveDateRange(req.query as any);
    const prev = previousRange(range);
    const granularity = getGranularity(range);

    const [totalRevenue, totalExpenses, prevRevenue, prevExpenses, timeline] = await Promise.all([
      sumRevenue(organizationId, range.from, range.to),
      sumExpenses(organizationId, range.from, range.to),
      sumRevenue(organizationId, prev.from, prev.to),
      sumExpenses(organizationId, prev.from, prev.to),
      buildTimeline(organizationId, range, granularity),
    ]);

    const categoryBreakdown = await database
      .select({ category: projectExpenses.category, amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))` })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(and(eq(projects.organizationId, organizationId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .groupBy(projectExpenses.category);

    const projectPerformance = await database
      .select({
        id: projects.id, name: projects.name, budget: projects.budget, currencyCode: projects.currencyCode,
        spent: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(projects)
      .leftJoin(projectExpenses, and(eq(projects.id, projectExpenses.projectId), gte(projectExpenses.date, range.from), lte(projectExpenses.date, range.to)))
      .where(projectReadScope(req.user!))
      .groupBy(projects.id)
      .orderBy(desc(sql`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`))
      .limit(5);

    const netProfit = totalRevenue - totalExpenses;
    const prevProfit = prevRevenue - prevExpenses;
    const avgMargin = totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 100) : null;

    return res.status(200).json({
      success: true,
      data: {
        currencyCode,
        totalRevenue,
        totalExpenses,
        netProfit,
        timeline,
        granularity,
        categoryBreakdown: categoryBreakdown.map((c) => ({ ...c, amount: Number(c.amount ?? 0) })),
        projectPerformance: projectPerformance.map((p) => ({ ...p, budget: Number(p.budget ?? 0), spent: Number(p.spent ?? 0) })),
        period: { from: range.from.toISOString().split("T")[0], to: range.to.toISOString().split("T")[0] },
        totals: {
          avgMargin,
        },
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
