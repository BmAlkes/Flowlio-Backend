import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import {
  userManagement,
  users,
  userOrganizations,
  account,
  files,
  fileVersions,
} from "@/schema/schema";
import { eq, and, count } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

// Postgres foreign key violation error code
const FK_VIOLATION_CODE = "23503";

type PgError = {
  code?: string;
  detail?: string;
  table?: string;
  constraint?: string;
  message?: string;
};

const isForeignKeyViolation = (error: unknown): error is PgError =>
  !!error &&
  typeof error === "object" &&
  (error as PgError).code === FK_VIOLATION_CODE;

export const deleteUserMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    // Log the request user information for debugging
    logger.info("🗑️ DeleteUserMember - Request user data:", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      isSuperAdmin: req.user?.isSuperAdmin,
      targetUserMemberId: id,
    });

    if (!organizationId) {
      logger.error("❌ DeleteUserMember - No organization ID found for user:", {
        userId: req.user?.id,
        userEmail: req.user?.email,
        isSuperAdmin: req.user?.isSuperAdmin,
      });

      return res.status(400).json({
        success: false,
        message:
          "User is not associated with an organization. Please make sure you are logged into an organization.",
      });
    }

    // Check if user member exists and belongs to the organization
    const userMember = await database
      .select()
      .from(userManagement)
      .where(
        and(
          eq(userManagement.id, id),
          eq(userManagement.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!userMember.length) {
      logger.warn("⚠️ DeleteUserMember - User member not found:", {
        userMemberId: id,
        organizationId,
      });

      return res.status(404).json({
        success: false,
        message: "User member not found",
      });
    }

    const memberToDelete = userMember[0];

    // Prevent deletion of the current user
    if (memberToDelete.email === req.user?.email) {
      logger.warn("⚠️ DeleteUserMember - Attempted to delete current user:", {
        userMemberId: id,
        userEmail: req.user?.email,
      });

      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    // Get user details for cascade deletion (may be null for partial/test accounts)
    const userDetails = await database.query.users.findFirst({
      where: (user, { eq }) => eq(user.email, memberToDelete.email),
    });

    if (!userDetails) {
      logger.warn("⚠️ DeleteUserMember - No users record found, deleting userManagement only:", {
        userMemberId: id,
        userEmail: memberToDelete.email,
      });
    }

    // Pre-flight check: some relations reference users.id with a NOT NULL,
    // RESTRICT (no onDelete) foreign key — e.g. files.uploadedBy and
    // fileVersions.uploadedBy — so deleting the user would otherwise fail
    // with a raw Postgres FK violation (500). Detect those up front and
    // return a clear, actionable error instead of letting the delete blow up.
    if (userDetails) {
      const [uploadedFiles] = await database
        .select({ total: count() })
        .from(files)
        .where(eq(files.uploadedBy, userDetails.id));

      const [uploadedFileVersions] = await database
        .select({ total: count() })
        .from(fileVersions)
        .where(eq(fileVersions.uploadedBy, userDetails.id));

      const blockers: string[] = [];
      if (uploadedFiles.total > 0) {
        blockers.push(`${uploadedFiles.total} uploaded file(s)`);
      }
      if (uploadedFileVersions.total > 0) {
        blockers.push(`${uploadedFileVersions.total} file version(s)`);
      }

      if (blockers.length > 0) {
        logger.warn("⚠️ DeleteUserMember - Blocked by related records:", {
          userMemberId: id,
          userId: userDetails.id,
          blockers,
        });

        return res.status(409).json({
          success: false,
          message: `Cannot delete user: they have ${blockers.join(
            " and "
          )}. Reassign or delete these first.`,
        });
      }
    }

    // Log activity before deletion
    const actorId = req.user?.id;
    if (organizationId && actorId && memberToDelete) {
      await logActivity({
        organizationId,
        actorId,
        userId: userDetails?.id ?? memberToDelete.id,
        type: "user",
        action: "delete",
        resource: "user",
        resourceId: userDetails?.id ?? memberToDelete.id,
        message: `Deleted user: ${memberToDelete.firstname} ${memberToDelete.lastname} (${memberToDelete.email})`,
        metadata: { role: memberToDelete.userrole },
      });
    }

    try {
      // Start transaction for cascade deletion
      await database.transaction(async (tx) => {
        // 1. Delete from userManagement table
        await tx.delete(userManagement).where(eq(userManagement.id, id));

        // 2-4. Only cascade to users/account/userOrganizations if the users record exists
        if (userDetails) {
          await tx
            .delete(userOrganizations)
            .where(
              and(
                eq(userOrganizations.userId, userDetails.id),
                eq(userOrganizations.organizationId, organizationId)
              )
            );
          await tx.delete(account).where(eq(account.userId, userDetails.id));
          await tx.delete(users).where(eq(users.id, userDetails.id));
        }

        logger.info("🗑️ User member deleted successfully:", {
          userMemberId: id,
          userId: userDetails?.id ?? "(no users record)",
          userEmail: memberToDelete.email,
          organizationId,
        });
      });
    } catch (deleteError) {
      // Known cause: a foreign key we didn't pre-check still has rows
      // pointing at this user (e.g. invoices, proposals, clients created by
      // them). Surface a clear 409 instead of falling through to the
      // generic 500 handler.
      if (isForeignKeyViolation(deleteError)) {
        console.error("[DeleteUserMember] Foreign key violation:", {
          userMemberId: id,
          userId: userDetails?.id,
          table: deleteError.table,
          constraint: deleteError.constraint,
          detail: deleteError.detail,
        });
        logger.error(
          { err: deleteError },
          "DeleteUserMember - foreign key violation while deleting user"
        );

        return res.status(409).json({
          success: false,
          message:
            "Cannot delete user: they still have related records (e.g. invoices, proposals, clients, or projects) referencing their account. Reassign or remove those first.",
        });
      }

      throw deleteError;
    }

    return res.status(200).json({
      success: true,
      message: "User member deleted successfully",
      data: {
        deletedUserMember: {
          id: memberToDelete.id,
          firstname: memberToDelete.firstname,
          lastname: memberToDelete.lastname,
          email: memberToDelete.email,
          userrole: memberToDelete.userrole,
          companyname: memberToDelete.companyname,
        },
        deletedUser: userDetails
          ? {
              id: userDetails.id,
              name: userDetails.name,
              email: userDetails.email,
              role: userDetails.role,
            }
          : null,
      },
    });
  } catch (error) {
    // Log the real error before falling back to the generic message —
    // `logger.error("msg", error)` (string first) does NOT merge `error`
    // into the pino log, it silently swallows the cause. Log it explicitly.
    console.error("[DeleteUserMember] Unexpected error:", error);
    logger.error({ err: error }, "Error deleting user member");

    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting user member",
      error: process.env.NODE_ENV === "development"
        ? error instanceof Error
          ? error.message
          : error
        : undefined,
    });
  }
};

// Soft delete - just deactivate the user member
export const deactivateUserMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "User is not associated with an organization.",
      });
    }

    // Check if user member exists and belongs to the organization
    const userMember = await database
      .select()
      .from(userManagement)
      .where(
        and(
          eq(userManagement.id, id),
          eq(userManagement.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!userMember.length) {
      return res.status(404).json({
        success: false,
        message: "User member not found",
      });
    }

    // Prevent deactivation of the current user
    if (userMember[0].email === req.user?.email) {
      return res.status(400).json({
        success: false,
        message: "You cannot deactivate your own account",
      });
    }

    // Update status to inactive
    const [updatedMember] = await database
      .update(userManagement)
      .set({
        status: "inactive",
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(userManagement.id, id))
      .returning();

    logger.info("🔒 User member deactivated:", {
      userMemberId: id,
      userEmail: updatedMember.email,
      organizationId,
    });

    return res.status(200).json({
      success: true,
      message: "User member deactivated successfully",
      data: {
        userMember: {
          id: updatedMember.id,
          firstname: updatedMember.firstname,
          lastname: updatedMember.lastname,
          email: updatedMember.email,
          status: updatedMember.status,
          isActive: updatedMember.isActive,
          updatedAt: updatedMember.updatedAt,
        },
      },
    });
  } catch (error) {
    logger.error("Error deactivating user member:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deactivating user member",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Reactivate a deactivated user member
export const reactivateUserMember = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "User is not associated with an organization.",
      });
    }

    // Check if user member exists and belongs to the organization
    const userMember = await database
      .select()
      .from(userManagement)
      .where(
        and(
          eq(userManagement.id, id),
          eq(userManagement.organizationId, organizationId)
        )
      )
      .limit(1);

    if (!userMember.length) {
      return res.status(404).json({
        success: false,
        message: "User member not found",
      });
    }

    // Update status to active
    const [updatedMember] = await database
      .update(userManagement)
      .set({
        status: "active",
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(userManagement.id, id))
      .returning();

    logger.info("✅ User member reactivated:", {
      userMemberId: id,
      userEmail: updatedMember.email,
      organizationId,
    });

    return res.status(200).json({
      success: true,
      message: "User member reactivated successfully",
      data: {
        userMember: {
          id: updatedMember.id,
          firstname: updatedMember.firstname,
          lastname: updatedMember.lastname,
          email: updatedMember.email,
          status: updatedMember.status,
          isActive: updatedMember.isActive,
          updatedAt: updatedMember.updatedAt,
        },
      },
    });
  } catch (error) {
    logger.error("Error reactivating user member:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while reactivating user member",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
