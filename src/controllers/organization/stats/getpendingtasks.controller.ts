import { database } from "@/configs/connection.config";
import { tasks, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getOrganizationPendingTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getOrganizationPendingTasks called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get count of pending tasks for this organization's projects
    // Pending = any status except 'completed'
    const result = await database
      .select({
        pendingTasks: sql<number>`COUNT(*)`,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        sql`${projects.organizationId} = ${organizationId} AND ${tasks.status} != 'completed'`
      );

    const pendingTasks = result[0]?.pendingTasks || 0;

    logger.info(
      `✅ Pending tasks for organization ${organizationId}: ${pendingTasks}`
    );

    res.status(200).json({
      success: true,
      message: "Pending tasks fetched successfully",
      data: {
        pendingTasks,
      },
    });
  } catch (error) {
    logger.error("Error fetching pending tasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
