import { database } from "@/configs/connection.config";
import { projects, clients, tasks } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getViewerProjects = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getViewerProjects called");

    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId) {
      res.status(400).json({
        success: false,
        message: "User ID is required",
      });
      return;
    }

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get projects assigned to this viewer/user with task counts
    const viewerProjects = await database
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        description: projects.description,
        status: projects.status,
        progress: projects.progress,
        startDate: projects.startDate,
        endDate: projects.endDate,
        assignedTo: projects.assignedTo,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        // Client information
        clientId: clients.id,
        clientName: clients.name,
        clientImage: clients.image,
        // Task counts
        totalTasks: sql<number>`COUNT(DISTINCT ${tasks.id})`,
        completedTasks: sql<number>`COUNT(DISTINCT CASE WHEN ${tasks.status} = 'completed' THEN ${tasks.id} END)`,
      })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .leftJoin(tasks, eq(projects.id, tasks.projectId))
      .where(
        sql`${projects.assignedTo} = ${userId} AND ${projects.organizationId} = ${organizationId}`
      )
      .groupBy(
        projects.id,
        projects.name,
        projects.projectNumber,
        projects.description,
        projects.status,
        projects.progress,
        projects.startDate,
        projects.endDate,
        projects.assignedTo,
        projects.createdAt,
        projects.updatedAt,
        clients.id,
        clients.name,
        clients.image
      )
      .orderBy(projects.createdAt);

    logger.info(
      `✅ Found ${viewerProjects.length} projects assigned to viewer ${userId}`
    );

    res.status(200).json({
      success: true,
      message: "Viewer projects fetched successfully",
      data: viewerProjects,
    });
  } catch (error) {
    logger.error("Error fetching viewer projects:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
