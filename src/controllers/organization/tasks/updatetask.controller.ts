import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { tasks, projects } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

interface UpdateTaskRequest extends Request {
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
  body: {
    title?: string;
    description?: string;
    projectId?: string;
    assignedTo?: string;
    status?:
      | "todo"
      | "in_progress"
      | "completed"
      | "updated"
      | "delay"
      | "changes";
    startDate?: string;
    endDate?: string;
    estimatedHours?: number;
    actualHours?: number;
    attachments?: Array<{
      id: string;
      name: string;
      url: string;
      size: number;
      type: string;
    }>;
  };
}

export const updateTask = async (
  req: UpdateTaskRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user as { organizationId?: string };
    const updateData = req.body;

    // Check if task exists and belongs to organization
    const existingTask = await database
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.id, id),
          eq(projects.organizationId, organizationId as string)
        )
      )
      .limit(1);

    if (!existingTask.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Prepare update data
    const updateFields: any = {
      updatedAt: new Date(),
    };

    if (updateData.title !== undefined) updateFields.title = updateData.title;
    if (updateData.description !== undefined)
      updateFields.description = updateData.description;
    if (updateData.projectId !== undefined)
      updateFields.projectId = updateData.projectId;
    if (updateData.assignedTo !== undefined)
      updateFields.assignedTo = updateData.assignedTo;
    if (updateData.status !== undefined)
      updateFields.status = updateData.status;
    if (updateData.startDate !== undefined)
      updateFields.startDate = updateData.startDate
        ? new Date(updateData.startDate)
        : null;
    if (updateData.endDate !== undefined)
      updateFields.endDate = updateData.endDate
        ? new Date(updateData.endDate)
        : null;
    if (updateData.estimatedHours !== undefined)
      updateFields.estimatedHours = updateData.estimatedHours
        ? updateData.estimatedHours.toString()
        : null;
    if (updateData.actualHours !== undefined)
      updateFields.actualHours = updateData.actualHours
        ? updateData.actualHours.toString()
        : null;
    if (updateData.attachments !== undefined)
      updateFields.attachments = updateData.attachments;

    // Get task details before update for activity log
    const taskBeforeUpdate = await database
      .select({ title: tasks.title, assignedTo: tasks.assignedTo })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    // Update task
    const updatedTask = await database
      .update(tasks)
      .set(updateFields)
      .where(eq(tasks.id, id))
      .returning();

    // Log activity
    const userId = (req.user as any)?.id;
    if (organizationId && userId && taskBeforeUpdate.length > 0) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: taskBeforeUpdate[0].assignedTo || undefined,
        type: "task",
        action: "update",
        resource: "task",
        resourceId: id,
        message: `Updated task: ${taskBeforeUpdate[0].title}`,
        metadata: { updatedFields: Object.keys(updateFields) },
      });
    }

    res.status(200).json({
      success: true,
      message: "Task updated successfully",
      data: updatedTask[0],
    });
  } catch (error) {
    logger.error("Error updating task:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
  }
};

export const updateTaskStatus = async (
  req: UpdateTaskRequest,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user as { organizationId?: string };
    const { status } = req.body;

    if (!status) {
      res.status(400).json({
        success: false,
        message: "Status is required",
      });
      return;
    }

    // Check if task exists and belongs to organization
    const existingTask = await database
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.id, id),
          eq(projects.organizationId, organizationId as string)
        )
      )
      .limit(1);

    if (!existingTask.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Prepare update data
    const updateFields: any = {
      status,
      updatedAt: new Date(),
    };

    // Get task details before update for activity log
    const taskBeforeUpdate = await database
      .select({ title: tasks.title, assignedTo: tasks.assignedTo })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    // Update task status
    const updatedTask = await database
      .update(tasks)
      .set(updateFields)
      .where(eq(tasks.id, id))
      .returning();

    // Log activity
    const userId = (req.user as any)?.id;
    if (organizationId && userId && taskBeforeUpdate.length > 0) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: taskBeforeUpdate[0].assignedTo || undefined,
        type: "task",
        action: "update",
        resource: "task",
        resourceId: id,
        message: `Updated task status to ${status}: ${taskBeforeUpdate[0].title}`,
        metadata: { status },
      });
    }

    res.status(200).json({
      success: true,
      message: "Task status updated successfully",
      data: updatedTask[0],
    });
  } catch (error) {
    logger.error("Error updating task status:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
    return;
  }
};
