import { database } from "@/configs/connection.config";
import { subadmin, updateSubAdminSchema } from "@/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq } from "drizzle-orm";
import status from "http-status";

export const updateSubAdmin = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Sub admin ID is required",
      });
    }

    // Validate the request body
    const validationResult = updateSubAdminSchema.safeParse(req.body);
    if (!validationResult.success) {
      logger.error("Validation error:", validationResult.error.issues);
      return res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: validationResult.error.issues,
      });
    }

    const updateData = validationResult.data;

    // Check if sub admin exists
    const existingSubAdmin = await database.query.subadmin.findFirst({
      where: (t, { eq }) => eq(t.id, id),
    });

    if (!existingSubAdmin) {
      return res.status(404).json({
        success: false,
        message: "Sub admin not found",
      });
    }

    // Update the sub admin
    const [updatedSubAdmin] = await database
      .update(subadmin)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(subadmin.id, id))
      .returning();

    logger.info(`Sub admin ${id} updated successfully`, {
      updatedFields: Object.keys(updateData),
      updatedBy: req.user?.id,
    });

    res.status(200).json({
      success: true,
      message: "Sub admin updated successfully",
      data: updatedSubAdmin,
    });
  } catch (error) {
    logger.error("Error updating sub admin:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const updateSubAdminPermission = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permission } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Sub admin ID is required",
      });
    }

    if (!permission || !["Active", "Deactivated"].includes(permission)) {
      return res.status(400).json({
        success: false,
        message: "Valid permission is required (Active or Deactivated)",
      });
    }

    // Check if sub admin exists
    const existingSubAdmin = await database.query.subadmin.findFirst({
      where: (t, { eq }) => eq(t.id, id),
    });

    if (!existingSubAdmin) {
      return res.status(404).json({
        success: false,
        message: "Sub admin not found",
      });
    }

    // Update the sub admin permission
    const [updatedSubAdmin] = await database
      .update(subadmin)
      .set({
        permission,
        updatedAt: new Date(),
      })
      .where(eq(subadmin.id, id))
      .returning();

    logger.info(`Sub admin ${id} permission updated to ${permission}`, {
      previousPermission: existingSubAdmin.permission,
      newPermission: permission,
      updatedBy: req.user?.id,
    });

    res.status(200).json({
      success: true,
      message: `Sub admin permission updated to ${permission}`,
      data: updatedSubAdmin,
    });
  } catch (error) {
    logger.error("Error updating sub admin permission:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
