import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import {
  userManagement,
  users,
  userOrganizations,
  account,
} from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

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

    // Get user details to perform cascade deletion
    const userDetails = await database.query.users.findFirst({
      where: (user, { eq }) => eq(user.email, memberToDelete.email),
    });

    if (!userDetails) {
      logger.warn("⚠️ DeleteUserMember - User not found in users table:", {
        userMemberId: id,
        userEmail: memberToDelete.email,
      });

      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Log activity before deletion
    const actorId = req.user?.id;
    if (organizationId && actorId && memberToDelete) {
      await logActivity({
        organizationId,
        actorId,
        userId: userDetails.id,
        type: "user",
        action: "delete",
        resource: "user",
        resourceId: userDetails.id,
        message: `Deleted user: ${memberToDelete.firstname} ${memberToDelete.lastname} (${memberToDelete.email})`,
        metadata: { role: memberToDelete.userrole },
      });
    }

    // Start transaction for cascade deletion
    await database.transaction(async (tx) => {
      // 1. Delete from userManagement table
      await tx.delete(userManagement).where(eq(userManagement.id, id));

      // 2. Delete from userOrganizations table
      await tx
        .delete(userOrganizations)
        .where(
          and(
            eq(userOrganizations.userId, userDetails.id),
            eq(userOrganizations.organizationId, organizationId)
          )
        );

      // 3. Delete from account table (Better Auth)
      await tx.delete(account).where(eq(account.userId, userDetails.id));

      // 4. Delete from users table
      await tx.delete(users).where(eq(users.id, userDetails.id));

      logger.info("🗑️ User member deleted successfully:", {
        userMemberId: id,
        userId: userDetails.id,
        userEmail: memberToDelete.email,
        organizationId,
      });
    });

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
        deletedUser: {
          id: userDetails.id,
          name: userDetails.name,
          email: userDetails.email,
          role: userDetails.role,
        },
      },
    });
  } catch (error) {
    logger.error("Error deleting user member:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting user member",
      error: process.env.NODE_ENV === "development" ? error : undefined,
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
