import { database } from "@/configs/connection.config";
import { tasks, projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";

export const getViewerTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getViewerTasks called");

    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    logger.info(
      `🔍 Searching for tasks assigned to user: ${userId} in organization: ${organizationId}`
    );

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

    // First, let's check if there are any tasks assigned to this user at all
    const allTasksForUser = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        assignedTo: tasks.assignedTo,
      })
      .from(tasks)
      .where(eq(tasks.assignedTo, userId));

    logger.info(
      `🔍 Found ${allTasksForUser.length} tasks assigned to user ${userId}:`,
      allTasksForUser
    );

    // Get tasks assigned to this viewer/user with project and client details
    const viewerTasks = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        endDate: tasks.endDate,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Project information
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        // Client information
        clientId: clients.id,
        clientName: clients.name,
        clientImage: clients.image,
        // Creator information
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        // Attachments stored as JSON array on the task
        attachments: tasks.attachments,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(tasks.createdBy, users.id))
      .where(
        and(
          eq(tasks.assignedTo, userId),
          eq(projects.organizationId, organizationId)
        )
      )
      .orderBy(tasks.createdAt);

    logger.info(
      `✅ Found ${viewerTasks.length} tasks assigned to viewer ${userId}`
    );

    res.status(200).json({
      success: true,
      message: "Viewer tasks fetched successfully",
      data: viewerTasks.map((t) => ({ ...t, attachments: t.attachments ?? [] })),
    });
  } catch (error) {
    logger.error("Error fetching viewer tasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
