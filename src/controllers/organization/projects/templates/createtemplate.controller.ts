import { Response } from "express";
import { database } from "../../../../configs/connection.config";
import { projectTemplates, projectTemplateTasks } from "../../../../schema/schema";
import { createProjectTemplateSchema } from "../../../../schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import { randomUUID } from "crypto";

export const createProjectTemplate = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const validatedData = createProjectTemplateSchema.parse(req.body);
    const { name, description, tasks } = validatedData;

    const templateId = randomUUID();
    await database.insert(projectTemplates).values({
      id: templateId,
      name,
      description,
      organizationId,
      createdBy: req.user?.id,
      isGlobal: false
    });

    if (tasks && tasks.length > 0) {
      const templateTasksValues = tasks.map((task, index) => ({
        id: randomUUID(),
        templateId: templateId,
        title: task.title,
        description: task.description,
        estimatedHours: task.estimatedHours ? String(task.estimatedHours) : null,
        order: task.order ?? index
      }));

      await database.insert(projectTemplateTasks).values(templateTasksValues as any);
    }

    res.status(status.CREATED).json({
      success: true,
      message: "Template created successfully",
      data: { id: templateId }
    });

  } catch (error) {
    logger.error("Error creating project template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error",
    });
  }
};
