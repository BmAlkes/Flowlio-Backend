import { Response } from "express";
import { database } from "../../../../configs/connection.config";
import { projectTemplates, projectTemplateTasks, tasks } from "../../../../schema/schema";
import { saveProjectAsTemplateSchema } from "../../../../schema/validation";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import { randomUUID } from "crypto";

export const saveProjectAsTemplate = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const validatedData = saveProjectAsTemplateSchema.parse(req.body);
    const { projectId, templateName, description } = validatedData;

    // 1. Verify project exists and belongs to org
    const project = await database.query.projects.findFirst({
      where: (p, { eq, and }) => and(eq(p.id, projectId), eq(p.organizationId, organizationId))
    });

    if (!project) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Project not found"
      });
      return;
    }

    // 2. Fetch all tasks for this project
    const projectTasks = await database
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId));

    // 3. Create the template
    const templateId = randomUUID();
    await database.insert(projectTemplates).values({
      id: templateId,
      name: templateName,
      description: description || project.description,
      organizationId: organizationId,
      createdBy: req.user?.id,
      isGlobal: false
    });

    // 4. Create template tasks
    if (projectTasks.length > 0) {
      const templateTasksValues = projectTasks.map((task, index) => ({
        id: randomUUID(),
        templateId: templateId,
        title: task.title,
        description: task.description,
        estimatedHours: task.estimatedHours,
        order: index
      }));

      await database.insert(projectTemplateTasks).values(templateTasksValues);
    }

    res.status(status.CREATED).json({
      success: true,
      message: "Project saved as template successfully",
      data: {
        id: templateId,
        name: templateName,
        taskCount: projectTasks.length
      }
    });

  } catch (error) {
    logger.error("Error saving project as template:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error",
    });
  }
};
