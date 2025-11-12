import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { database } from "../../../configs/connection.config";
import { projects } from "../../../schema/schema";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

interface DeleteProjectRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
    isSuperAdmin: boolean;
    subadminId?: string;
    createdAt: Date;
    updatedAt: Date;
    role: string;
    organizationId?: string;
    organization?: any;
    userOrganization?: any;
  };
}

export const deleteProject = async (
  req: DeleteProjectRequest,
  res: Response
): Promise<void> => {
  try {
    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const organizationId = req.user.organizationId;
    const { id: projectId } = req.params;

    logger.info(
      `Delete project request - Project ID: ${projectId}, Organization ID: ${organizationId}`
    );

    if (!projectId) {
      res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

    // Check if project exists and belongs to the organization
    const existingProject = await database
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId as string)
        )
      )
      .limit(1);

    if (existingProject.length === 0) {
      logger.warn(
        `Project not found - Project ID: ${projectId}, Organization ID: ${organizationId}`
      );
      res.status(404).json({
        success: false,
        message: "Project not found or access denied",
      });
      return;
    }

    // Log activity before deletion
    const userId = req.user?.id;
    if (organizationId && userId && existingProject[0]) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId: existingProject[0].assignedTo || undefined,
        type: "project",
        action: "delete",
        resource: "project",
        resourceId: projectId,
        message: `Deleted project: ${existingProject[0].name}`,
      });
    }

    // Delete project
    const deletedProject = await database
      .delete(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.organizationId, organizationId as string)
        )
      )
      .returning();

    if (deletedProject.length === 0) {
      res.status(500).json({
        success: false,
        message: "Failed to delete project",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Project deleted successfully",
      data: {
        id: deletedProject[0].id,
        deleted: true,
      },
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while deleting project",
    });
  }
};
