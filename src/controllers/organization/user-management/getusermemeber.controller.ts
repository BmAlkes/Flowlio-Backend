import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { userManagement, userOrganizations } from "@/schema/schema";
import { eq, and } from "drizzle-orm";

export const getAllUserMembers = async (req: Request, res: Response) => {
  try {
    // Log the request user information for debugging
    logger.info("🔍 GetAllUserMembers - Request user data:", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      isSuperAdmin: req.user?.isSuperAdmin,
    });

    // Get organization ID from authenticated user
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      logger.error(
        "❌ GetAllUserMembers - No organization ID found for user:",
        {
          userId: req.user?.id,
          userEmail: req.user?.email,
          isSuperAdmin: req.user?.isSuperAdmin,
        }
      );

      return res.status(400).json({
        success: false,
        message:
          "User is not associated with an organization. Please make sure you are logged into an organization.",
      });
    }

    // Get query parameters for pagination and filtering
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const userrole = (req.query.userrole as string) || "";

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build where conditions
    let whereConditions = [eq(userManagement.organizationId, organizationId)];

    if (search) {
      whereConditions.push(eq(userManagement.firstname, search));
    }

    if (status) {
      whereConditions.push(eq(userManagement.status, status));
    }

    if (userrole) {
      whereConditions.push(eq(userManagement.userrole, userrole));
    }

    // Get total count for pagination
    const totalCount = await database
      .select({ count: userManagement.id })
      .from(userManagement)
      .where(and(...whereConditions));

    // Get user members with pagination
    const userMembers = await database
      .select({
        id: userManagement.id,
        firstname: userManagement.firstname,
        lastname: userManagement.lastname,
        email: userManagement.email,
        phonenumber: userManagement.phonenumber,
        userrole: userManagement.userrole,
        companyname: userManagement.companyname,
        setpermission: userManagement.setpermission,
        status: userManagement.status,
        isActive: userManagement.isActive,
        organizationId: userManagement.organizationId,
        createdBy: userManagement.createdBy,
        createdAt: userManagement.createdAt,
        updatedAt: userManagement.updatedAt,
        lastLoginAt: userManagement.lastLoginAt,
        loginAttempts: userManagement.loginAttempts,
        lockedUntil: userManagement.lockedUntil,
        position: userManagement.position,
      })
      .from(userManagement)
      .where(and(...whereConditions))
      .orderBy(userManagement.createdAt)
      .limit(limit)
      .offset(offset);

    // Get additional user data for each member
    const enrichedUserMembers = await Promise.all(
      userMembers.map(async (member) => {
        // Get user details from users table
        const userDetails = await database.query.users.findFirst({
          where: (user, { eq }) => eq(user.email, member.email),
        });

        // Get user organization details
        const userOrgDetails = await database.query.userOrganizations.findFirst(
          {
            where: (userOrg, { eq, and }) =>
              and(
                eq(userOrg.userId, userDetails?.id || ""),
                eq(userOrg.organizationId, organizationId)
              ),
          }
        );

        logger.info(`🔍 Enriching member ${member.email}:`, {
          hasUserDetails: !!userDetails,
          userDetailsId: userDetails?.id,
          userDetailsRole: userDetails?.role,
          memberUserrole: member.userrole,
        });

        return {
          ...member,
          user: userDetails
            ? {
                id: userDetails.id,
                name: userDetails.name,
                email: userDetails.email,
                role: userDetails.role,
                image: userDetails.image,
                emailVerified: userDetails.emailVerified,
                isSuperAdmin: userDetails.isSuperAdmin,
              }
            : {
                // Fallback to userManagement data if users table doesn't have the record
                id: member.id,
                name: `${member.firstname} ${member.lastname}`,
                email: member.email,
                role: member.userrole,
                image: null,
                emailVerified: false,
                isSuperAdmin: false,
              },
          userOrganization: userOrgDetails
            ? {
                id: userOrgDetails.id,
                role: userOrgDetails.role,
                permissions: userOrgDetails.permissions,
                status: userOrgDetails.status,
                joinedAt: userOrgDetails.joinedAt,
              }
            : {
                // Fallback to userManagement data if users table doesn't have the record
                id: member.id,
                name: `${member.firstname} ${member.lastname}`,
                email: member.email,
                role: member.userrole,
                image: null,
                emailVerified: false,
                isSuperAdmin: false,
              },
        };
      })
    );

    // Calculate pagination info
    const totalPages = Math.ceil(totalCount.length / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    logger.info(
      `📋 Retrieved ${enrichedUserMembers.length} user members for organization: ${organizationId}`
    );

    return res.status(200).json({
      success: true,
      message: "User members retrieved successfully",
      data: {
        userMembers: enrichedUserMembers,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: totalCount.length,
          itemsPerPage: limit,
          hasNextPage,
          hasPrevPage,
        },
      },
    });
  } catch (error) {
    logger.error("Error retrieving user members:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving user members",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Get user members for the CURRENT organization (no pagination)
export const getCurrentOrgUserMembers = async (req: Request, res: Response) => {
  try {
    // Log the request user information for debugging
    logger.info("🔍 GetCurrentOrgUserMembers - Request user data:", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      isSuperAdmin: req.user?.isSuperAdmin,
    });

    // Get organization ID from authenticated user
    const organizationId = req.user?.organizationId;
    logger.info("🔍 GetCurrentOrgUserMembers - Request user data:", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      isSuperAdmin: req.user?.isSuperAdmin,
      fullUserObject: JSON.stringify(req.user, null, 2),
    });

    if (!organizationId) {
      logger.error(
        "❌ GetCurrentOrgUserMembers - No organization ID found for user:",
        {
          userId: req.user?.id,
          userEmail: req.user?.email,
          isSuperAdmin: req.user?.isSuperAdmin,
        }
      );

      return res.status(400).json({
        success: false,
        message:
          "User is not associated with an organization. Please make sure you are logged into an organization.",
        data: {
          userMembers: [],
          totalCount: 0,
          organizationId: null,
        },
      });
    }

    logger.info(`🔍 Using organization ID: ${organizationId}`);

    // Get all user members for the current organization (no pagination)
    logger.info(
      `🔍 Querying userManagement table for organization: ${organizationId}`
    );

    // First, let's check if there are ANY user members in the table
    const allUserMembers = await database
      .select({
        id: userManagement.id,
        organizationId: userManagement.organizationId,
        email: userManagement.email,
        userrole: userManagement.userrole,
      })
      .from(userManagement);

    logger.info(
      `🔍 Total user members in userManagement table: ${allUserMembers.length}`
    );
    logger.info(
      "All user members:",
      allUserMembers.map((m) => ({
        id: m.id,
        organizationId: m.organizationId,
        email: m.email,
        userrole: m.userrole,
      }))
    );

    const userMembers = await database
      .select({
        id: userManagement.id,
        firstname: userManagement.firstname,
        lastname: userManagement.lastname,
        email: userManagement.email,
        phonenumber: userManagement.phonenumber,
        userrole: userManagement.userrole,
        companyname: userManagement.companyname,
        setpermission: userManagement.setpermission,
        status: userManagement.status,
        isActive: userManagement.isActive,
        organizationId: userManagement.organizationId,
        createdBy: userManagement.createdBy,
        createdAt: userManagement.createdAt,
        updatedAt: userManagement.updatedAt,
        lastLoginAt: userManagement.lastLoginAt,
        loginAttempts: userManagement.loginAttempts,
        lockedUntil: userManagement.lockedUntil,
        position: userManagement.position,
      })
      .from(userManagement)
      .where(eq(userManagement.organizationId, organizationId))
      .orderBy(userManagement.createdAt);

    logger.info(
      `📋 Found ${userMembers.length} user members in userManagement table:`,
      userMembers.map((m) => ({
        id: m.id,
        email: m.email,
        userrole: m.userrole,
        firstname: m.firstname,
        lastname: m.lastname,
        organizationId: m.organizationId,
        createdBy: m.createdBy,
      }))
    );

    // Also check if there are any users with 'viewer' role specifically
    const viewerUsers = userMembers.filter((m) => m.userrole === "viewer");
    logger.info(
      `👀 Found ${viewerUsers.length} users with 'viewer' role:`,
      viewerUsers.map((m) => ({
        id: m.id,
        email: m.email,
        name: `${m.firstname} ${m.lastname}`,
        createdBy: m.createdBy,
      }))
    );

    // Check if current user is in the list
    const currentUserId = req.user?.id;
    const currentUserInList = userMembers.find((m) => m.id === currentUserId);
    logger.info(
      `🔍 Current user (${currentUserId}) in userManagement table:`,
      currentUserInList ? "YES" : "NO"
    );

    // Include current user for support ticket assignment
    const assignableUsers = userMembers; // Don't filter out current user
    logger.info(
      `👥 All users (including current user): ${assignableUsers.length}`,
      assignableUsers.map((m) => ({
        id: m.id,
        email: m.email,
        name: `${m.firstname} ${m.lastname}`,
        role: m.userrole,
      }))
    );

    // Get additional user data for each member
    const enrichedUserMembers = await Promise.all(
      userMembers.map(async (member) => {
        // Get user details from users table
        const userDetails = await database.query.users.findFirst({
          where: (user, { eq }) => eq(user.email, member.email),
        });

        // Get user organization details
        const userOrgDetails = await database.query.userOrganizations.findFirst(
          {
            where: (userOrg, { eq, and }) =>
              and(
                eq(userOrg.userId, userDetails?.id || ""),
                eq(userOrg.organizationId, organizationId)
              ),
          }
        );

        logger.info(`🔍 Enriching member ${member.email}:`, {
          hasUserDetails: !!userDetails,
          userDetailsId: userDetails?.id,
          userDetailsRole: userDetails?.role,
          memberUserrole: member.userrole,
        });

        return {
          ...member,
          user: userDetails
            ? {
                id: userDetails.id,
                name: userDetails.name,
                email: userDetails.email,
                role: userDetails.role,
                image: userDetails.image,
                emailVerified: userDetails.emailVerified,
                isSuperAdmin: userDetails.isSuperAdmin,
              }
            : {
                // Fallback to userManagement data if users table doesn't have the record
                id: member.id,
                name: `${member.firstname} ${member.lastname}`,
                email: member.email,
                role: member.userrole,
                image: null,
                emailVerified: false,
                isSuperAdmin: false,
              },
          userOrganization: userOrgDetails
            ? {
                id: userOrgDetails.id,
                role: userOrgDetails.role,
                permissions: userOrgDetails.permissions,
                status: userOrgDetails.status,
                joinedAt: userOrgDetails.joinedAt,
              }
            : {
                // Fallback to userManagement data if users table doesn't have the record
                id: member.id,
                name: `${member.firstname} ${member.lastname}`,
                email: member.email,
                role: member.userrole,
                image: null,
                emailVerified: false,
                isSuperAdmin: false,
              },
        };
      })
    );

    logger.info(
      `📋 Retrieved ${enrichedUserMembers.length} user members for current organization: ${organizationId}`
    );

    // Inject org owner if not already in the list.
    // The owner is identified via userOrganizations (role "org" or "owner") but is
    // never added to userManagement through the normal invite flow.
    const allEnriched = await injectOrgOwner(enrichedUserMembers, organizationId);

    return res.status(200).json({
      success: true,
      message: "Current organization user members retrieved successfully",
      data: {
        userMembers: allEnriched,
        totalCount: allEnriched.length,
        organizationId: organizationId,
      },
    });
  } catch (error) {
    logger.error("Error retrieving current organization user members:", error);
    return res.status(500).json({
      success: false,
      message:
        "Internal server error while retrieving current organization user members",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Injects users from userOrganizations that are not already represented in
 * the userManagement-sourced member list. This covers the org owner (and any
 * other user added via userOrganizations rather than the invite flow),
 * regardless of what role string was stored in userOrganizations.role.
 */
async function injectOrgOwner(
  enrichedMembers: any[],
  organizationId: string,
): Promise<any[]> {
  try {
    // Collect users.id values already in the list (from the enriched .user.id)
    const existingUserIds = new Set(
      enrichedMembers.map((m) => m.user?.id).filter(Boolean),
    );

    // Fetch ALL userOrganizations entries for this org — no role filter,
    // because the owner's role string varies across orgs ("org", "owner",
    // "admin", etc.) and we just want anyone not already in the list.
    const uoRows = await database
      .select({
        userId: userOrganizations.userId,
        role: userOrganizations.role,
        permissions: userOrganizations.permissions,
        status: userOrganizations.status,
        joinedAt: userOrganizations.joinedAt,
        uoId: userOrganizations.id,
      })
      .from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));

    if (uoRows.length === 0) return enrichedMembers;

    const ownersToInject: any[] = [];

    for (const ownerRow of uoRows) {
      if (existingUserIds.has(ownerRow.userId)) continue;

      const ownerUser = await database.query.users.findFirst({
        where: (u, { eq }) => eq(u.id, ownerRow.userId),
      });
      if (!ownerUser) continue;

      const nameParts = (ownerUser.name ?? "").split(" ");
      const firstname = nameParts[0] ?? "";
      const lastname = nameParts.slice(1).join(" ");

      ownersToInject.push({
        // Use the users.id as the synthetic record id so the frontend
        // reads member.user.id correctly for assignment.
        id: ownerUser.id,
        firstname,
        lastname,
        email: ownerUser.email,
        phonenumber: null,
        userrole: ownerRow.role,
        companyname: null,
        setpermission: null,
        status: "active",
        isActive: true,
        organizationId,
        createdBy: null,
        createdAt: ownerUser.createdAt,
        updatedAt: ownerUser.updatedAt,
        lastLoginAt: null,
        loginAttempts: null,
        lockedUntil: null,
        position: -1,
        isOrgOwner: true,
        user: {
          id: ownerUser.id,
          name: ownerUser.name,
          email: ownerUser.email,
          role: ownerUser.role,
          image: ownerUser.image,
          emailVerified: ownerUser.emailVerified,
          isSuperAdmin: ownerUser.isSuperAdmin,
        },
        userOrganization: {
          id: ownerRow.uoId,
          role: ownerRow.role,
          permissions: ownerRow.permissions,
          status: ownerRow.status,
          joinedAt: ownerRow.joinedAt,
        },
      });

      existingUserIds.add(ownerUser.id);
    }

    // Owners go first in the list
    return [...ownersToInject, ...enrichedMembers];
  } catch (err) {
    logger.error("injectOrgOwner: failed to inject owner, returning original list", err);
    return enrichedMembers;
  }
}
