import { Response } from "express";
import { database } from "../../../../configs/connection.config";
import { projectTemplates, projectTemplateTasks } from "../../../../schema/schema";
import { eq, or } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

import { randomUUID } from "crypto";

export const getTemplates = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    // Fetch global templates AND organization specific templates
    let templates = await database
      .select()
      .from(projectTemplates)
      .where(
        or(
          eq(projectTemplates.isGlobal, true),
          eq(projectTemplates.organizationId, organizationId)
        )
      );

    // If no templates found, seed default global templates
    if (templates.length === 0) {
      const defaultTemplates = [
        {
          id: randomUUID(),
          name: "Software Development",
          description: "Standard agile workflow for software projects",
          isGlobal: true,
          tasks: [
            { title: "Requirement Analysis", description: "Analyze user requirements and technical specs", order: 0 },
            { title: "System Design", description: "Architecture and database design", order: 1 },
            { title: "Frontend Development", description: "UI and client-side logic", order: 2 },
            { title: "Backend Development", description: "API and server-side logic", order: 3 },
            { title: "Testing & QA", description: "Unit, integration, and user acceptance testing", order: 4 },
            { title: "Deployment", description: "Production environment setup and release", order: 5 },
          ]
        },
        {
          id: randomUUID(),
          name: "Marketing Campaign",
          description: "Standard steps for launching a marketing campaign",
          isGlobal: true,
          tasks: [
            { title: "Market Research", description: "Identify target audience and competitors", order: 0 },
            { title: "Strategy Definition", description: "Define goals and key messages", order: 1 },
            { title: "Content Creation", description: "Write copy and design visuals", order: 2 },
            { title: "Channel Setup", description: "Configure social media and ads", order: 3 },
            { title: "Launch", description: "Go live with the campaign", order: 4 },
            { title: "Analytics & Reporting", description: "Track performance and ROI", order: 5 },
          ]
        }
      ];

      for (const t of defaultTemplates) {
        await database.insert(projectTemplates).values({
          id: t.id,
          name: t.name,
          description: t.description,
          isGlobal: true,
        });

        const taskValues = t.tasks.map(task => ({
          id: randomUUID(),
          templateId: t.id,
          title: task.title,
          description: task.description,
          order: task.order
        }));

        await database.insert(projectTemplateTasks).values(taskValues);
      }

      // Re-fetch after seeding
      templates = await database
        .select()
        .from(projectTemplates)
        .where(
          or(
            eq(projectTemplates.isGlobal, true),
            eq(projectTemplates.organizationId, organizationId)
          )
        );
    }

    // For each template, we might want to fetch the count of tasks
    const templatesWithTaskCount = await Promise.all(
      templates.map(async (template) => {
        const tasks = await database
          .select()
          .from(projectTemplateTasks)
          .where(eq(projectTemplateTasks.templateId, template.id));
        
        return {
          ...template,
          taskCount: tasks.length,
          tasks: tasks.sort((a, b) => a.order - b.order)
        };
      })
    );

    res.status(status.OK).json({
      success: true,
      data: templatesWithTaskCount,
    });
  } catch (error) {
    logger.error("Error fetching project templates:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
    });
  }
};
