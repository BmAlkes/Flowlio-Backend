import { deleteSingleResouceFromCloudinary } from "@/utils/cloudinary.util";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";
import { eq } from "drizzle-orm";
import { account, subadmin, users } from "@/schema";

export const deleteSubAdmin = async (req: Request, res: Response) => {
  try {
    const params = req.params as { id: string } | undefined;

    if (!params?.id) {
      throw new Error("Sub Admin ID is required");
    }

    const existingSubAdmin = await database.query.subadmin.findFirst({
      where: (t, { eq }) => eq(t.id, params.id),
    });

    if (!existingSubAdmin) {
      logger.error("Sub Admin not found");
      throw new Error("Sub Admin not found");
    }

    const existingUser = await database.query.users.findFirst({
      where: (t, { eq }) => eq(t.email, existingSubAdmin.email),
      columns: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        isSuperAdmin: true,
        subadminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!existingUser) {
      logger.error("User record not found for sub admin");
      throw new Error("User record not found for sub admin");
    }

    if (existingSubAdmin.logoPublicId) {
      await deleteSingleResouceFromCloudinary(
        existingSubAdmin.logoPublicId,
        "image"
      );
    }

    const isAccountDeleted = await database
      .delete(account)
      .where(eq(account.userId, existingUser.id));
    logger.info(`Account deleted for user: ${existingUser.id}`);

    const isUserDeleted = await database
      .delete(users)
      .where(eq(users.id, existingUser.id));
    logger.info(`User deleted: ${existingUser.id}`);

    const isSubAdminDeleted = await database
      .delete(subadmin)
      .where(eq(subadmin.id, params.id));

    if (
      isSubAdminDeleted.rowCount &&
      isUserDeleted.rowCount &&
      isAccountDeleted.rowCount
    ) {
      logger.info(
        `Sub Admin deleted successfully - Sub Admin ID: ${params.id}, User ID: ${existingUser.id}`
      );
      res.json({
        message: "Sub Admin and all related records deleted successfully",
      });
    } else {
      logger.error("Failed to delete sub admin or related records");
      throw new Error("Failed to delete sub admin or related records");
    }
  } catch (error) {
    logger.error("Error deleting sub admin:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
