import { Response } from "express";
import { database } from "../../../../configs/connection.config";
import { projectTemplates, projectTemplateTasks } from "../../../../schema/schema";
import { createProjectTemplateSchema } from "../../../../schema/validation";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import { randomUUID } from "crypto";

export const updateProjectTemplate = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id } = req.params;
    const validatedData = createProjectTemplateSchema.partial().parse(req.body);
    const { name, description, tasks } = validatedData;

    // Check if template exists and belongs to the organization
    const existingTemplate = await database
      .select()
      .from(projectTemplates)
      .where(
        and(
          eq(projectTemplates.id, id),
          eq(projectTemplates.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingTemplate.length === 0) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Template not found or you don't have permission to edit it",
      });
      return;
    }

    // Update template details
    await database
      .update(projectTemplates)
      .set({
        ...(name && { name }),
        ...(description !== undefined && { description }),
      })
      .where(eq(projectTemplates.id, id));

    // If tasks are provided, replace existing tasks
    if (tasks) {
      // Delete existing tasks
      await database
        .delete(projectTemplateTasks)
        .where(eq(projectTemplateTasks.templateId, id));

      // Insert new tasks
      if (tasks.length > 0) {
        const templateTasksValues = tasks.map((task, index) => ({
          id: randomUUID(),
          templateId: id,
          title: task.title,
          description: task.description,
          estimatedHours: task.estimatedHours ? String(task.estimatedHours) : null,
          order: task.order ?? index
        }));

        await database.insert(projectTemplateTasks).values(templateTasksValues as any);
      }
    }

    res.status(status.OK).json({
      success: true,
      message: "Template updated successfully",
    });

  } catch (error) {
    logger.error("Error updating project template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error",
    });
  }
};
