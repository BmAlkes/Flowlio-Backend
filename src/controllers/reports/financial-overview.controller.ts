import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { invoices, projectExpenses, projects } from "@/schema/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const getFinancialOverview = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.user as any;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

    // 1. Total Revenue (Paid Invoices)
    const revenueResult = await database
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${invoices.amount} AS DECIMAL)), 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.status, "paid")
        )
      );

    // 2. Total Expenses
    const expensesResult = await database
      .select({
        total: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(eq(projects.organizationId, organizationId));

    // 3. Monthly Breakdown (Last 6 Months)
    // We'll fetch all paid invoices and expenses from the last 6 months and group them in JS for simplicity
    // or use a more complex SQL query. Let's use a simpler approach of fetching and grouping.
    
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyRevenue = await database
      .select({
        month: sql<string>`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`,
        amount: sql<number>`SUM(CAST(${invoices.amount} AS DECIMAL))`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, organizationId),
          eq(invoices.status, "paid"),
          sql`${invoices.datepaid} >= ${sixMonthsAgo}`
        )
      )
      .groupBy(sql`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${invoices.datepaid}, 'YYYY-MM')`);

    const monthlyExpenses = await database
      .select({
        month: sql<string>`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`,
        amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`,
      })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(
        and(
          eq(projects.organizationId, organizationId),
          sql`${projectExpenses.date} >= ${sixMonthsAgo}`
        )
      )
      .groupBy(sql`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(${projectExpenses.date}, 'YYYY-MM')`);

    // 4. Category Breakdown
    const categoryBreakdown = await database
      .select({
        category: projectExpenses.category,
        amount: sql<number>`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`,
      })
      .from(projectExpenses)
      .innerJoin(projects, eq(projectExpenses.projectId, projects.id))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(projectExpenses.category);

    // 5. Project Performance (Top 5 by Expense)
    const projectPerformance = await database
      .select({
        id: projects.id,
        name: projects.name,
        budget: projects.budget,
        spent: sql<number>`COALESCE(SUM(CAST(${projectExpenses.amount} AS DECIMAL)), 0)`,
      })
      .from(projects)
      .leftJoin(projectExpenses, eq(projects.id, projectExpenses.projectId))
      .where(eq(projects.organizationId, organizationId))
      .groupBy(projects.id)
      .orderBy(desc(sql`SUM(CAST(${projectExpenses.amount} AS DECIMAL))`))
      .limit(5);

    // Combine monthly data
    const months = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (6 - i));
      return d.toISOString().slice(0, 7); // YYYY-MM
    });

    const timeline = months.map((m: string) => ({
      month: m,
      revenue: monthlyRevenue.find((r: { month: string; amount: number }) => r.month === m)?.amount || 0,
      expenses: monthlyExpenses.find((e: { month: string; amount: number }) => e.month === m)?.amount || 0,
    }));

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue: revenueResult[0]?.total || 0,
        totalExpenses: expensesResult[0]?.total || 0,
        netProfit: (revenueResult[0]?.total || 0) - (expensesResult[0]?.total || 0),
        timeline,
        categoryBreakdown,
        projectPerformance,
      },
    });
  } catch (error) {
    logger.error("Error fetching financial overview:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
