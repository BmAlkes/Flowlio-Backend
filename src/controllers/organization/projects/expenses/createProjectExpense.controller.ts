import { database } from "@/configs/connection.config";
import { projectExpenses, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";

/**
 * Add a new expense to a project
 * POST /api/projects/:projectId/expenses
 */
export const createProjectExpense = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { projectId } = req.params;
    const { amount, category, description, date } = req.body;
    const organizationId = req.user?.organizationId;
    const userId = req.user?.id;

    if (!projectId || !organizationId || !userId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Project ID, Organization ID, and User ID are required",
      });
      return;
    }

    // Validation
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Amount must be a positive number",
      });
      return;
    }

    if (!category || !description) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Category and description are required",
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

    // Create the expense
    const [newExpense] = await database
      .insert(projectExpenses)
      .values({
        projectId,
        amount: amount.toString(),
        category,
        description,
        date: date ? new Date(date) : new Date(),
        createdBy: userId,
      })
      .returning();

    res.status(status.CREATED).json({
      success: true,
      message: "Expense created successfully",
      data: newExpense,
    });
  } catch (error) {
    logger.error("Error creating project expense:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
