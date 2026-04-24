import { database } from "@/configs/connection.config";
import { projectExpenses, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import status from "http-status";

/**
 * Delete a specific expense
 * DELETE /api/projects/:projectId/expenses/:expenseId
 */
export const deleteProjectExpense = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { projectId, expenseId } = req.params;
    const organizationId = req.user?.organizationId;

    if (!projectId || !expenseId || !organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Project ID, Expense ID, and Organization ID are required",
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

    // Delete the expense
    const result = await database
      .delete(projectExpenses)
      .where(
        and(
          eq(projectExpenses.id, expenseId),
          eq(projectExpenses.projectId, projectId),
        ),
      )
      .returning();

    if (result.length === 0) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Expense not found",
      });
      return;
    }

    res.status(status.OK).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting project expense:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
