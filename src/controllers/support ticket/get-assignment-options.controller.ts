import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import {
  organizations,
  users,
  userManagement,
} from "@/schema/schema";
import status from "http-status";

export const getAssignmentOptions = async (
  req: any,
  res: Response,
): Promise<void> => {
  try {
    const user = req.user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Only superadmin and subadmin can access assignment options
    if (user.role !== "superadmin" && user.role !== "subadmin") {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "You don't have permission to access assignment options",
      });
      return;
    }

    let organizationsList: any[] = [];
    let usersList: any[] = [];

    if (user.role === "superadmin") {
      // Superadmin can see all organizations and users
      organizationsList = await database.query.organizations.findMany({
        columns: {
          id: true,
          name: true,
        },
        orderBy: (organizations, { asc }) => [asc(organizations.name)],
      });

      // Get all user members from userManagement table for superadmin
      const allUserMembers = await database
        .select({
          id: userManagement.id,
          firstname: userManagement.firstname,
          lastname: userManagement.lastname,
          email: userManagement.email,
          userrole: userManagement.userrole,
          organizationId: userManagement.organizationId,
        })
        .from(userManagement)
        .orderBy(userManagement.firstname);

      // Enrich user members with user details
      usersList = await Promise.all(
        allUserMembers.map(async (member) => {
          const userDetails = await database.query.users.findFirst({
            where: (user, { eq }) => eq(user.email, member.email),
            columns: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          });

          const orgDetails = await database.query.organizations.findFirst({
            where: eq(organizations.id, member.organizationId || ""),
            columns: {
              id: true,
              name: true,
            },
          });

          return {
            id: userDetails?.id || member.id,
            name: userDetails?.name || `${member.firstname} ${member.lastname}`,
            email: member.email,
            role: userDetails?.role || member.userrole,
            organization: orgDetails
              ? {
                  id: orgDetails.id,
                  name: orgDetails.name,
                }
              : undefined,
          };
        }),
      );
    } else if (user.role === "subadmin") {
      // Subadmin can only see their own organization and users within it
      const userOrg = await database.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId || ""),
        columns: {
          id: true,
          name: true,
        },
      });

      if (userOrg) {
        organizationsList = [userOrg];
      }

      // Get user members from userManagement table for subadmin's organization
      const orgUserMembers = await database
        .select({
          id: userManagement.id,
          firstname: userManagement.firstname,
          lastname: userManagement.lastname,
          email: userManagement.email,
          userrole: userManagement.userrole,
          organizationId: userManagement.organizationId,
        })
        .from(userManagement)
        .where(eq(userManagement.organizationId, user.organizationId || ""))
        .orderBy(userManagement.firstname);

      // Enrich user members with user details
      usersList = await Promise.all(
        orgUserMembers.map(async (member) => {
          const userDetails = await database.query.users.findFirst({
            where: (user, { eq }) => eq(user.email, member.email),
            columns: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          });

          return {
            id: userDetails?.id || member.id,
            name: userDetails?.name || `${member.firstname} ${member.lastname}`,
            email: member.email,
            role: userDetails?.role || member.userrole,
            organization: {
              id: user.organizationId,
              name: userOrg?.name || "Unknown Organization",
            },
          };
        }),
      );
    } else if (user.role === "user") {
      // Regular users can only see themselves
      const currentUser = await database.query.users.findFirst({
        where: eq(users.id, user.id),
        columns: {
          id: true,
          name: true,
          email: true,
          role: true,
        },
      });

      if (currentUser) {
        usersList = [currentUser];
      }
      // No organizations for regular users
      organizationsList = [];
    }

    logger.info(
      `Retrieved assignment options for user ${user.id} (${user.role})`,
    );
    logger.info(
      `Found ${organizationsList.length} organizations and ${usersList.length} users`,
    );

    res.status(status.OK).json({
      success: true,
      message: "Assignment options retrieved successfully",
      data: {
        organizations: organizationsList,
        users: usersList,
      },
    });
  } catch (error) {
    logger.error("Error retrieving assignment options:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to retrieve assignment options",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
