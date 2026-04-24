import { database } from "@/configs/connection.config";
import { projectExpenses, users, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, desc } from "drizzle-orm";
import status from "http-status";

/**
 * Get all expenses for a specific project
 * GET /api/projects/:projectId/expenses
 */
export const getProjectExpenses = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { projectId } = req.params;
    const organizationId = req.user?.organizationId;

    if (!projectId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

    if (!organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Verify project belongs to the user's organization
    const project = await database.query.projects.findFirst({
      where: and(
        eq(projects.id, projectId),
        eq(projects.organizationId, organizationId),
      ),
    });

    if (!project) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Project not found or access denied",
      });
      return;
    }

    // Fetch expenses with creator name
    const expenses = await database
      .select({
        id: projectExpenses.id,
        projectId: projectExpenses.projectId,
        amount: projectExpenses.amount,
        category: projectExpenses.category,
        description: projectExpenses.description,
        date: projectExpenses.date,
        createdBy: projectExpenses.createdBy,
        createdByName: users.name,
        createdAt: projectExpenses.createdAt,
        updatedAt: projectExpenses.updatedAt,
      })
      .from(projectExpenses)
      .leftJoin(users, eq(projectExpenses.createdBy, users.id))
      .where(eq(projectExpenses.projectId, projectId))
      .orderBy(desc(projectExpenses.date));

    res.status(status.OK).json({
      success: true,
      message: "Expenses fetched successfully",
      data: expenses,
    });
  } catch (error) {
    logger.error("Error fetching project expenses:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
