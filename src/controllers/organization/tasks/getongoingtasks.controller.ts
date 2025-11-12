import { database } from "@/configs/connection.config";
import { tasks, projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import status from "http-status";

export const getOngoingTasks = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("📊 getOngoingTasks called");

    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Get ongoing tasks (status: todo, in_progress, delay, changes, updated) for this organization
    const ongoingTasks = await database
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
        projectProgress: projects.progress,
        // Client information
        clientId: clients.id,
        clientName: clients.name,
        clientImage: clients.image,
        // Creator information (who created the task)
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        creatorImage: users.image,
        // Assigned user information
        assignedToId: sql<string>`${tasks.assignedTo}`,
        assignedToName: sql<string>`assigned_user.name`,
        assignedToEmail: sql<string>`assigned_user.email`,
        assignedToImage: sql<string>`assigned_user.image`,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .innerJoin(clients, eq(projects.clientId, clients.id))
      .innerJoin(users, eq(tasks.createdBy, users.id)) // Join with users for creator info
      .leftJoin(
        sql`${users} as assigned_user`,
        sql`${tasks.assignedTo} = assigned_user.id`
      )
      .where(
        and(
          eq(projects.organizationId, organizationId),
          sql`${tasks.status} IN ('todo', 'in_progress', 'delay', 'changes', 'updated')`
        )
      )
      .orderBy(tasks.createdAt)
      .limit(10); // Limit to 10 ongoing tasks for dashboard

    logger.info(
      `✅ Fetched ${ongoingTasks.length} ongoing tasks (todo, in_progress, delay, changes, updated) for organization ${organizationId}`
    );

    res.status(200).json({
      success: true,
      message: "Ongoing tasks fetched successfully",
      data: ongoingTasks,
    });
  } catch (error) {
    logger.error("Error fetching ongoing tasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
