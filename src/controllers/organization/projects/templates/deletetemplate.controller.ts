import { Response } from "express";
import { database } from "../../../../configs/connection.config";
import { projectTemplates, projectTemplateTasks } from "../../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

export const deleteProjectTemplate = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;

    // Check if template exists and belongs to the organization
    const template = await database
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, id),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .limit(1);

    if (template.length === 0) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Template not found or you don't have permission to delete it",
      });
      return;
    }

    // Delete tasks first (though they might have CASCADE if configured, but safe to do manually)
    await database
      .delete(projectTemplateTasks)
      .where(eq(projectTemplateTasks.templateId, id));

    // Delete the template
    await database
      .delete(projectTemplates)
      .where(eq(projectTemplates.id, id));

    res.status(status.OK).json({
      success: true,
      message: "Template deleted successfully",
    });

  } catch (error) {
    logger.error("Error deleting project template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error",
    });
  }
};
