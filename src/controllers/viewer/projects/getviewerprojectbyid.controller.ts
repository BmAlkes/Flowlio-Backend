import { database } from "@/configs/connection.config";
import { projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { sql, eq } from "drizzle-orm";
import status from "http-status";

export const getViewerProjectById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getViewerProjectById called");

    const projectId = req.params.id;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!projectId) {
      res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

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

    // Get project assigned to this viewer/user
    const viewerProject = await database
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
        address: projects.address,
        contractfile: projects.contractfile,
        projectFiles: projects.projectFiles,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        // Client information
        clientId: clients.id,
        clientName: clients.name,
        clientImage: clients.image,
        clientEmail: clients.email,
        clientPhone: clients.phone,
        clientAddress: clients.address,
        // Assigned user information
        assignedUserName: users.name,
        assignedUserEmail: users.email,
      })
      .from(projects)
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(projects.assignedTo, users.id))
      .where(
        sql`${projects.id} = ${projectId} AND ${projects.assignedTo} = ${userId} AND ${projects.organizationId} = ${organizationId}`
      )
      .limit(1);

    if (viewerProject.length === 0) {
      res.status(404).json({
        success: false,
        message: "Project not found or you don't have permission to view it",
      });
      return;
    }

    const project = viewerProject[0];

    logger.info(`✅ Found project ${projectId} assigned to viewer ${userId}`);

    res.status(200).json({
      success: true,
      message: "Viewer project fetched successfully",
      data: project,
    });
  } catch (error) {
    logger.error("Error fetching viewer project:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
