import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { userManagement, users, userOrganizations } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { getRealOrganizationOwnerUserId } from "@/utils/organization.util";
import { logActivity } from "@/utils/activity.util";
import { setOrganizationManagerSchema } from "@/schema/validation";

const VIEWER_ROLE = "viewer";
const USER_ROLE = "user";

/**
 * PATCH /organizations/user-members/:memberId/organization-manager
 * Body: { setAsManager: true } to promote, { setAsManager: false } to demote.
 * Only the real organization owner (purchaser) or allowed admin may call.
 * Never demote the real owner.
 */
export const setOrganizationManager = async (req: Request, res: Response) => {
  try {
    const memberId = req.params.memberId as string;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message:
          "User is not associated with an organization. Please make sure you are logged into an organization.",
      });
    }

    const bodyResult = setOrganizationManagerSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: bodyResult.error.errors,
      });
    }
    const { setAsManager } = bodyResult.data;

    // Resolve member and ensure they belong to this organization
    const memberRows = await database
      .select()
      .from(userManagement)
      .where(
        and(
          eq(userManagement.id, memberId),
          eq(userManagement.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!memberRows.length) {
      return res.status(404).json({
        success: false,
        message: "User member not found",
      });
    }

    const member = memberRows[0];
    // userRecord may be null for members that exist only in userManagement (no users table entry)
    const userRecord = await database.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, member.email),
    });

    const userOrgRow = userRecord
      ? await database.query.userOrganizations.findFirst({
          where: (uo, { eq, and }) =>
            and(
              eq(uo.userId, userRecord.id),
              eq(uo.organizationId, organizationId),
            ),
        })
      : null;

    const realOwnerUserId =
      await getRealOrganizationOwnerUserId(organizationId);

    if (setAsManager) {
      // Promote: role = "user", isOrganizationManager = true
      const alreadyManager =
        userRecord?.role === USER_ROLE &&
        userRecord?.isOrganizationManager === true;
      if (alreadyManager) {
        return res.status(200).json({
          success: true,
          message: "Member is already an organization manager",
          data: {
            userMember: {
              id: member.id,
              email: member.email,
              userrole: USER_ROLE,
              isOrganizationManager: true,
            },
          },
        });
      }

      if (userRecord) {
        await database
          .update(users)
          .set({
            role: USER_ROLE,
            isOrganizationManager: true,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userRecord.id));
      }

      await database
        .update(userManagement)
        .set({
          userrole: USER_ROLE,
          updatedAt: new Date(),
        })
        .where(eq(userManagement.id, memberId));

      if (userOrgRow) {
        await database
          .update(userOrganizations)
          .set({
            role: USER_ROLE,
            permissions: {
              canManageUsers: true,
              canManageProjects: true,
              canManageBilling: true,
              canViewAnalytics: true,
              canInviteUsers: true,
            },
            updatedAt: new Date(),
          })
          .where(eq(userOrganizations.id, userOrgRow.id));
      }

      const actorId = req.user?.id;
      if (organizationId && actorId) {
        await logActivity({
          organizationId,
          actorId,
          userId: userRecord?.id ?? member.id,
          type: "user",
          action: "update",
          resource: "user",
          resourceId: userRecord?.id ?? member.id,
          message: `Promoted to organization manager: ${member.firstname} ${member.lastname} (${member.email})`,
          metadata: { role: USER_ROLE, isOrganizationManager: true },
        });
      }

      logger.info("Promoted member to organization manager", {
        memberId,
        userId: userRecord?.id ?? "(no users record)",
        organizationId,
      });

      return res.status(200).json({
        success: true,
        message: "Member promoted to organization manager",
        data: {
          userMember: {
            id: member.id,
            email: member.email,
            userrole: USER_ROLE,
            isOrganizationManager: true,
          },
        },
      });
    }

    // Demote: role = "viewer", isOrganizationManager = false (never for real owner)
    if (realOwnerUserId && userRecord?.id === realOwnerUserId) {
      return res.status(400).json({
        success: false,
        message: "Cannot demote the organization owner (purchaser).",
      });
    }

    const alreadyViewer =
      userRecord?.role === VIEWER_ROLE &&
      userRecord?.isOrganizationManager === false;
    if (alreadyViewer) {
      return res.status(200).json({
        success: true,
        message: "Member is already a viewer",
        data: {
          userMember: {
            id: member.id,
            email: member.email,
            userrole: VIEWER_ROLE,
            isOrganizationManager: false,
          },
        },
      });
    }

    if (userRecord) {
      await database
        .update(users)
        .set({
          role: VIEWER_ROLE,
          isOrganizationManager: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userRecord.id));
    }

    await database
      .update(userManagement)
      .set({
        userrole: VIEWER_ROLE,
        updatedAt: new Date(),
      })
      .where(eq(userManagement.id, memberId));

    if (userOrgRow) {
      await database
        .update(userOrganizations)
        .set({
          role: VIEWER_ROLE,
          permissions: {
            canManageUsers: false,
            canManageProjects: false,
            canManageBilling: false,
            canViewAnalytics: true,
            canInviteUsers: false,
          },
          updatedAt: new Date(),
        })
        .where(eq(userOrganizations.id, userOrgRow.id));
    }

    const actorId = req.user?.id;
    if (organizationId && actorId) {
      await logActivity({
        organizationId,
        actorId,
        userId: userRecord?.id ?? member.id,
        type: "user",
        action: "update",
        resource: "user",
        resourceId: userRecord?.id ?? member.id,
        message: `Demoted to viewer: ${member.firstname} ${member.lastname} (${member.email})`,
        metadata: { role: VIEWER_ROLE, isOrganizationManager: false },
      });
    }

    logger.info("Demoted member to viewer", {
      memberId,
      userId: userRecord?.id ?? "(no users record)",
      organizationId,
    });

    return res.status(200).json({
      success: true,
      message: "Member demoted to viewer",
      data: {
        userMember: {
          id: member.id,
          email: member.email,
          userrole: VIEWER_ROLE,
          isOrganizationManager: false,
        },
      },
    });
  } catch (error) {
    logger.error("Error in setOrganizationManager:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
