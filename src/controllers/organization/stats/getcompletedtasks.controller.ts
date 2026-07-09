import { database } from "@/configs/connection.config";
import { tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getOrganizationCompletedTasks = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization ID is required" });
      return;
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const result = await database
      .select({ completedTasks: sql<number>`COUNT(*)` })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        sql`${projects.organizationId} = ${organizationId}
          AND ${tasks.status} = 'completed'
          AND ${tasks.updatedAt} >= ${monthStart}`,
      );

    const completedTasks = Number(result[0]?.completedTasks ?? 0);

    logger.info(`✅ Completed tasks (this month) for org ${organizationId}: ${completedTasks}`);

    res.status(200).json({
      success: true,
      message: "Completed tasks fetched successfully",
      data: { completedTasks },
    });
  } catch (error) {
    logger.error("Error fetching completed tasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
