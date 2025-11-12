import { database } from "@/configs/connection.config";
import { projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql } from "drizzle-orm";
import status from "http-status";

export const getOrganizationActiveProjects = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getOrganizationActiveProjects called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get count of active projects for this organization
    // Active = status = 'active' OR status = 'ongoing'
    const result = await database
      .select({
        activeProjects: sql<number>`COUNT(*)`,
      })
      .from(projects)
      .where(
        sql`${projects.organizationId} = ${organizationId} AND (${projects.status} = 'active' OR ${projects.status} = 'ongoing')`
      );

    const activeProjects = result[0]?.activeProjects || 0;

    logger.info(
      `✅ Active projects for organization ${organizationId}: ${activeProjects}`
    );

    res.status(200).json({
      success: true,
      message: "Active projects fetched successfully",
      data: {
        activeProjects,
      },
    });
  } catch (error) {
    logger.error("Error fetching active projects:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
