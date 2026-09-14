import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { StatusCodes } from "http-status-codes";

export const getCurrentUserProfile = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userReq = req as any;
    if (!userReq.user || !userReq.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = userReq.user.id;

    // Get user data with role column
    const user = await database.query.users.findFirst({
      where: (t, { eq }) => eq(t.id, userId),
      columns: {
        id: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        emailVerified: true,
        twoFactorEnabled: true,
        notificationPreferences: true,
        image: true,
        role: true,
        isOrganizationOwner: true,
        isOrganizationManager: true,
        isSuperAdmin: true,
        subadminId: true,
        status: true, // Include user status (pending/active)
        selectedPlanId: true, // Include selected plan ID
        pendingOrganizationData: true, // Include pending organization data
        createdAt: true,
        updatedAt: true,
      },
    });

    // logger.info(`User data from database:`, JSON.stringify(user, null, 2));

    if (!user) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Fetch client profile if role is 'client'
    let clientProfile = null;
    if (user.role === "client") {
      clientProfile = await database.query.clients.findFirst({
        where: (t, { eq }) => eq(t.userId, userId),
      });
    }

    // Check if user status is pending (needs to complete payment)
    // Allow pending users to access profile but return special code for frontend redirect
    if (!user.isSuperAdmin && !user.subadminId && user.role !== "client") {
      const userStatus = user.status?.toLowerCase?.() || user.status || "";
      const isPending =
        userStatus === "pending" || !user.status || user.status === null;

      if (isPending) {
        // Check if user has payment data (can complete payment)
        const hasPaymentData = !!(
          user.selectedPlanId || user.pendingOrganizationData
        );

        logger.info("🔍 User Status Check:", {
          userId: user.id,
          status: user.status,
          isPending,
          hasPaymentData,
          selectedPlanId: user.selectedPlanId,
          hasPendingOrgData: !!user.pendingOrganizationData,
        });

        // Return special response for pending users - frontend will redirect to checkout
        res.status(403).json({
          success: false,
          message: hasPaymentData
            ? "Your account is pending payment. Please complete your payment to access your account."
            : "Your account is pending payment. Please select a plan and complete payment to access your account.",
          code: hasPaymentData ? "USER_PENDING" : "USER_PENDING_NO_PLAN",
          redirectTo: hasPaymentData ? "/checkout" : "/pricing",
          data: {
            id: user.id,
            name: user.name,
            email: user.email,
            status: user.status,
            selectedPlanId: user.selectedPlanId,
            pendingOrganizationData: user.pendingOrganizationData,
          },
        });
        return;
      }
    }

    const selectedOrg = req.user?.organization;
    const demoOrgInfo =
      selectedOrg?.settings?.demo === true
        ? {
            isDemo: true,
            passwordChanged: selectedOrg.settings.passwordChanged === true,
          }
        : null;

    // Get organization information from req.user (set by auth middleware)
    const organizationId = userReq.user?.organizationId;
    const organization = userReq.user?.organization;

    // Use the actual role from database, but override for superadmin/subadmin
    const userWithRole = {
      ...user,
      role: user.isSuperAdmin
        ? "superadmin"
        : user.subadminId
          ? "subadmin"
          : user.role || "user", // Use actual role from database
      isOrganizationOwner: user.isOrganizationOwner ?? false,
      isOrganizationManager: user.isOrganizationManager ?? false,
      organizationId: organizationId || null,
      organization: organization || null,
      demoOrgInfo: demoOrgInfo, // Include demo organization info
      clientProfile: clientProfile, // Include client business profile if role is 'client'
    };

    // logger.info(`User profile fetched for user: ${userId}`);
    // logger.info(`User isSuperAdmin: ${userWithRole.isSuperAdmin}`);
    // logger.info(`User role: ${userWithRole.role}`);
    logger.info(
      `User role from database: ${user.role}, Final role: ${userWithRole.role}`,
    );
    logger.info(
      `User isSuperAdmin: ${user.isSuperAdmin}, subadminId: ${user.subadminId}`,
    );
    logger.info(`Raw user data:`, JSON.stringify(user, null, 2));
    // logger.info(`Final response data:`, JSON.stringify(userWithRole, null, 2));

    res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: userWithRole,
    });
  } catch (error) {
    logger.error("Error fetching user profile:", error);
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while fetching user profile",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Update user profile function has been moved to updateuserprofile.controller.ts
// to avoid duplication and use the more robust implementation with validation
