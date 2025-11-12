import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projects, tasks, invoices } from "@/schema/schema";
import { sql } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const getSuperadminOverview = async (_req: Request, res: Response) => {
  try {
    logger.info("📊 getSuperadminOverview called");

    const [{ totalProjects }] = await database
      .select({ totalProjects: sql<number>`COUNT(*)` })
      .from(projects);

    const [{ totalTasks }] = await database
      .select({ totalTasks: sql<number>`COUNT(*)` })
      .from(tasks);

    const [{ totalInvoices }] = await database
      .select({ totalInvoices: sql<number>`COUNT(*)` })
      .from(invoices);

    res.status(200).json({
      success: true,
      message: "Overview counts fetched successfully",
      data: {
        projectsCount: totalProjects || 0,
        tasksCount: totalTasks || 0,
        invoicesCount: totalInvoices || 0,
      },
    });
  } catch (error) {
    logger.error("Error in getSuperadminOverview:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
