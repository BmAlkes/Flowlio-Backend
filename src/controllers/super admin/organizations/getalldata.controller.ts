import { database } from "@/configs/connection.config";
import { organizations, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";

export const getAllData = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getAllData called for superadmin");

    // Get all organizations with their creation dates
    const allOrganizations = await database
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
      })
      .from(organizations);

    // Get all projects with their creation dates
    const allProjects = await database
      .select({
        id: projects.id,
        name: projects.name,
        createdAt: projects.createdAt,
      })
      .from(projects);

    logger.info(
      `✅ Fetched ${allOrganizations.length} organizations and ${allProjects.length} projects`
    );

    res.status(200).json({
      success: true,
      message: "All data fetched successfully",
      data: {
        organizations: allOrganizations,
        projects: allProjects,
      },
    });
  } catch (error) {
    logger.error("Error fetching all data:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
