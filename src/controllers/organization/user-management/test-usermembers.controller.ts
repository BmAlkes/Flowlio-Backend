import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { userManagement } from "@/schema/schema";
import status from "http-status";

export const testUserMembers = async (req: Request, res: Response) => {
  try {
    logger.info("🧪 Testing user members endpoint");

    // Get all user members from userManagement table
    const allUserMembers = await database
      .select({
        id: userManagement.id,
        firstname: userManagement.firstname,
        lastname: userManagement.lastname,
        email: userManagement.email,
        userrole: userManagement.userrole,
        organizationId: userManagement.organizationId,
        status: userManagement.status,
        isActive: userManagement.isActive,
        createdAt: userManagement.createdAt,
      })
      .from(userManagement);

    logger.info(
      `🧪 Found ${allUserMembers.length} total user members in database`
    );

    // Get user's organization ID
    const organizationId = req.user?.organizationId;
    logger.info(`🧪 User's organization ID: ${organizationId}`);

    // Get user members for specific organization
    let orgUserMembers: any[] = [];
    if (organizationId) {
      orgUserMembers = await database
        .select({
          id: userManagement.id,
          firstname: userManagement.firstname,
          lastname: userManagement.lastname,
          email: userManagement.email,
          userrole: userManagement.userrole,
          organizationId: userManagement.organizationId,
          status: userManagement.status,
          isActive: userManagement.isActive,
          createdAt: userManagement.createdAt,
        })
        .from(userManagement)
        .where(eq(userManagement.organizationId, organizationId));

      logger.info(
        `🧪 Found ${orgUserMembers.length} user members for organization ${organizationId}`
      );
    }

    res.status(status.OK).json({
      success: true,
      message: "User members test completed",
      data: {
        totalUserMembers: allUserMembers.length,
        allUserMembers: allUserMembers,
        userOrganizationId: organizationId,
        orgUserMembersCount: orgUserMembers.length,
        orgUserMembers: orgUserMembers,
        userInfo: {
          id: req.user?.id,
          email: req.user?.email,
          role: req.user?.role,
          organizationId: req.user?.organizationId,
        },
      },
    });
  } catch (error) {
    logger.error("Error in test user members:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to test user members",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
