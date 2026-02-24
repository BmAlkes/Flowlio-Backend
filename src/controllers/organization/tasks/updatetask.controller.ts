import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { tasks, projects } from "../../../schema/schema";
import { eq, and, ne } from "drizzle-orm";
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
    parentId?: string;
    startAfter?: string;
    finishBefore?: string;
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
      .select({ id: tasks.id, projectId: tasks.projectId })
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

    // Normalize and validate parentId when provided
    if (updateData.parentId !== undefined) {
      const normalizedParentId =
        updateData.parentId === "" ? null : updateData.parentId;

      if (normalizedParentId) {
        if (normalizedParentId === id) {
          res.status(400).json({
            success: false,
            message: "Task cannot be parent of itself",
          });
          return;
        }

        const parentTask = await database
          .select({ id: tasks.id, projectId: tasks.projectId })
          .from(tasks)
          .leftJoin(projects, eq(tasks.projectId, projects.id))
          .where(
            and(
              eq(tasks.id, normalizedParentId),
              eq(projects.organizationId, organizationId as string)
            )
          )
          .limit(1);

        if (!parentTask.length) {
          res.status(400).json({
            success: false,
            message: "Parent task not found",
          });
          return;
        }

        const effectiveProjectId =
          updateData.projectId !== undefined
            ? updateData.projectId
            : existingTask[0].projectId;
        if (parentTask[0].projectId !== effectiveProjectId) {
          res.status(400).json({
            success: false,
            message: "Subtask must belong to same project as parent task",
          });
          return;
        }
      }

      updateFields.parentId = normalizedParentId;
    }

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
    if (updateData.startAfter !== undefined)
      updateFields.startAfter = updateData.startAfter ?? null;
    if (updateData.finishBefore !== undefined)
      updateFields.finishBefore = updateData.finishBefore ?? null;

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

    // Fetch current task and verify it exists and belongs to organization
    const currentTaskRows = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        startAfter: tasks.startAfter,
        status: tasks.status,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.id, id),
          eq(projects.organizationId, organizationId as string)
        )
      )
      .limit(1);

    if (!currentTaskRows.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    const currentTask = currentTaskRows[0];

    // Only enforce dependency validation when marking as completed
    if (status === "completed") {
      // 3) Validate startAfter: prerequisite task must be completed first
      if (currentTask.startAfter != null && currentTask.startAfter.trim() !== "") {
        const startAfterRows = await database
          .select({ id: tasks.id, title: tasks.title, status: tasks.status })
          .from(tasks)
          .leftJoin(projects, eq(tasks.projectId, projects.id))
          .where(
            and(
              eq(tasks.id, currentTask.startAfter),
              eq(projects.organizationId, organizationId as string)
            )
          )
          .limit(1);

        const startAfterTask = startAfterRows[0];
        if (
          startAfterTask &&
          startAfterTask.status != null &&
          startAfterTask.status !== "completed"
        ) {
          res.status(400).json({
            success: false,
            message: `Before completing this task, please complete "${startAfterTask.title}" first.`,
          });
          return;
        }
      }

      // 4) Validate reverse finishBefore: no task that must finish before this one may be incomplete
      const dependentRows = await database
        .select({ id: tasks.id, title: tasks.title, status: tasks.status })
        .from(tasks)
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .where(
          and(
            eq(tasks.finishBefore, id),
            ne(tasks.status, "completed"),
            eq(projects.organizationId, organizationId as string)
          )
        )
        .limit(1);

      const dependentTask = dependentRows[0];
      if (dependentTask) {
        res.status(400).json({
          success: false,
          message: `Before completing this task, please complete "${dependentTask.title}" first.`,
        });
        return;
      }
    }

    // 5) All validations passed – proceed with status update
    const updateFields: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    const taskBeforeUpdate = await database
      .select({ title: tasks.title, assignedTo: tasks.assignedTo })
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);

    const updatedTask = await database
      .update(tasks)
      .set(updateFields)
      .where(eq(tasks.id, id))
      .returning();

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
