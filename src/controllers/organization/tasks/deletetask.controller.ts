import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { tasks, projects } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";
import { automationService } from "@/services/automation/automation.service";

interface DeleteTaskRequest extends Request {
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

export const deleteTask = async (
  req: DeleteTaskRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { organizationId } = req.user as { organizationId?: string };

    // Check if task exists and belongs to organization
    const existingTask = await database
      .select({
        id: tasks.id,
        title: tasks.title,
        assignedTo: tasks.assignedTo,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(tasks.id, id),
          eq(projects.organizationId, organizationId as string),
        ),
      )
      .limit(1);

    if (!existingTask.length) {
      res.status(404).json({
        success: false,
        message: "Task not found",
      });
      return;
    }

    // Log activity before deletion
    const userId = (req.user as any)?.id;
    if (organizationId && userId && existingTask[0]) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: existingTask[0].assignedTo || undefined,
        type: "task",
        action: "delete",
        resource: "task",
        resourceId: id,
        message: `Deleted task: ${existingTask[0].title}`,
      });
    }

    // Delete task
    await database.delete(tasks).where(eq(tasks.id, id));

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
    });

    // Recalculate project progress/status after response is sent
    const projectId = existingTask[0].projectId;
    if (projectId) {
      await automationService
        .recalculateProjectProgress(projectId)
        .catch((err) => {
          logger.error(
            `Failed to recalculate progress for project ${projectId}:`,
            err,
          );
        });

      await automationService
        .recalculateProjectStatus(projectId)
        .catch((err) => {
          logger.error(
            `Failed to recalculate status for project ${projectId}:`,
            err,
          );
        });
    }
  } catch (error) {
    logger.error("Error deleting task:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      errors: [error],
    });
  }
};
