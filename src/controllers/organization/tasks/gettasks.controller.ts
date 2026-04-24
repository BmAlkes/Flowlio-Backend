import { Request, Response } from "express";
import { tasks, projects, users, clients } from "../../../schema/schema";
import { eq, and, desc, or } from "drizzle-orm";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";

interface GetTasksRequest extends Request {
  user?: {
    id: string;
    organizationId?: string;
    role: string;
    name: string;
    email: string;
    emailVerified: boolean;
    isSuperAdmin: boolean;
    createdAt: Date;
    updatedAt: Date;
    organization?: any;
    userOrganization?: any;
  };
}

export const getTasks = async (req: GetTasksRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { organizationId } = req.user;
    const { projectId, status, assignedTo } = req.query;

    // Build query conditions
    const conditions = [eq(tasks.projectId, projects.id)];

    if (projectId) {
      conditions.push(eq(tasks.projectId, projectId as string));
    }

    if (status) {
      conditions.push(
        eq(
          tasks.status,
          status as
            | "todo"
            | "in_progress"
            | "completed"
            | "updated"
            | "delay"
            | "changes",
        ),
      );
    }

    if (assignedTo) {
      conditions.push(eq(tasks.assignedTo, assignedTo as string));
    }

    // Get tasks with related data
    const tasksData = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        endDate: tasks.endDate,
        startDate: tasks.startDate,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        attachments: tasks.attachments,
        parentId: tasks.parentId,
        startAfter: tasks.startAfter,
        finishBefore: tasks.finishBefore,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Project data
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        // Assignee data
        assigneeId: users.id,
        assigneeName: users.name,
        assigneeEmail: users.email,
        assigneeImage: users.image,
        // Creator data
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        // Client data
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        clientImage: clients.image,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assignedTo, users.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          ...conditions,
          eq(projects.organizationId, organizationId as string),
          or(
            eq(tasks.createdBy, req.user.id),
            eq(tasks.assignedTo, req.user.id),
            eq(tasks.visibility, "public"),
          ),
        ),
      )
      .orderBy(desc(tasks.createdAt));

    res.status(200).json({
      success: true,
      message: "Tasks retrieved successfully",
      data: tasksData,
    });
  } catch (error) {
    logger.error("Error fetching tasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
    return;
  }
};

export const getTaskById = async (
  req: GetTasksRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id } = req.params;
    const { organizationId } = req.user;

    const taskData = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        endDate: tasks.endDate,
        startDate: tasks.startDate,
        attachments: tasks.attachments,
        parentId: tasks.parentId,
        startAfter: tasks.startAfter,
        finishBefore: tasks.finishBefore,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        // Project data
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        // Assignee data
        assigneeId: users.id,
        assigneeName: users.name,
        assigneeEmail: users.email,
        assigneeImage: users.image,
        // Creator data
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        // Client data
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        clientImage: clients.image,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assignedTo, users.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(tasks.id, id),
          eq(projects.organizationId, organizationId as string),
          or(
            eq(tasks.createdBy, req.user.id),
            eq(tasks.assignedTo, req.user.id),
            eq(tasks.visibility, "public"),
          ),
        ),
      )
      .limit(1);

    if (!taskData.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Task retrieved successfully",
      data: taskData[0],
    });
  } catch (error) {
    logger.error("Error fetching task:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
    return;
  }
};

export const getSubtasksByTaskId = async (
  req: GetTasksRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { id: parentTaskId } = req.params;
    const { organizationId } = req.user;

    // Verify parent task exists and belongs to organization
    const parentTask = await database
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.id, parentTaskId),
          eq(projects.organizationId, organizationId as string),
        ),
      )
      .limit(1);

    if (!parentTask.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Fetch subtasks (tasks where parentId = parent task id)
    const subtasksData = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        endDate: tasks.endDate,
        startDate: tasks.startDate,
        estimatedHours: tasks.estimatedHours,
        actualHours: tasks.actualHours,
        attachments: tasks.attachments,
        parentId: tasks.parentId,
        startAfter: tasks.startAfter,
        finishBefore: tasks.finishBefore,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        assigneeId: users.id,
        assigneeName: users.name,
        assigneeEmail: users.email,
        assigneeImage: users.image,
        creatorId: users.id,
        creatorName: users.name,
        creatorEmail: users.email,
        clientId: clients.id,
        clientName: clients.name,
        clientEmail: clients.email,
        clientImage: clients.image,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assignedTo, users.id))
      .leftJoin(clients, eq(projects.clientId, clients.id))
      .where(
        and(
          eq(tasks.parentId, parentTaskId),
          eq(projects.organizationId, organizationId as string),
          or(
            eq(tasks.createdBy, req.user.id),
            eq(tasks.assignedTo, req.user.id),
            eq(tasks.visibility, "public"),
          ),
        ),
      )
      .orderBy(desc(tasks.createdAt));

    res.status(200).json({
      success: true,
      message: "Subtasks retrieved successfully",
      data: subtasksData,
    });
  } catch (error) {
    logger.error("Error fetching subtasks:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
    return;
  }
};
