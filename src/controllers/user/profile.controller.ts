import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { userOrganizations, organizations } from "@/schema/schema";
import { eq } from "drizzle-orm";

export const getCurrentUserProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;

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

    // Check if user status is pending (needs to complete payment)
    // Allow pending users to access profile but return special code for frontend redirect
    if (!user.isSuperAdmin && !user.subadminId) {
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
            status: user.status,
            selectedPlanId: user.selectedPlanId,
            pendingOrganizationData: user.pendingOrganizationData,
          },
        });
        return;
      }
    }

    // Check if user's organization is deactivated (unless super admin)
    // Skip this check for pending users without organizations (they haven't completed payment yet)
    let demoOrgInfo: { isDemo: boolean; passwordChanged: boolean } | null =
      null;

    if (!user.isSuperAdmin) {
      // Only check organization status if user has an organization
      // Pending users might not have an organization yet
      const userOrg = await database
        .select({
          organizationId: userOrganizations.organizationId,
          orgStatus: organizations.status,
          orgName: organizations.name,
          trialEndsAt: organizations.trialEndsAt,
          subscriptionStatus: organizations.subscriptionStatus,
          orgSettings: organizations.settings,
        })
        .from(userOrganizations)
        .innerJoin(
          organizations,
          eq(userOrganizations.organizationId, organizations.id)
        )
        .where(eq(userOrganizations.userId, userId))
        .limit(1);

      // Only perform organization checks if user has an organization
      // Pending users without organizations should be allowed to access profile
      if (userOrg.length > 0 && userOrg[0].orgStatus) {
        const orgData = userOrg[0];
        const orgStatus = orgData.orgStatus;

        // Check if this is a demo organization and get passwordChanged status
        const settings = orgData.orgSettings as any;
        if (settings?.demo === true) {
          demoOrgInfo = {
            isDemo: true,
            passwordChanged: settings?.passwordChanged ?? false,
          };
        }

        // Check 1: Organization is deactivated
        if (orgStatus === "suspended" || orgStatus === "inactive") {
          logger.warn(
            `User ${userId} attempted to login with deactivated organization ${orgData.organizationId}`
          );
          res.status(403).json({
            success: false,
            message:
              "ORGANIZATION_DEACTIVATED: Your organization account has been deactivated. Please contact the administrator for assistance.",
            code: "ORGANIZATION_DEACTIVATED",
          });
          return;
        }

        // Check 2: Trial period has expired
        const trialEndsAt = orgData.trialEndsAt;
        const subscriptionStatus = orgData.subscriptionStatus;
        const now = new Date();

        if (trialEndsAt) {
          const trialEndDate = new Date(trialEndsAt);

          // If trial has expired AND subscription is not active/valid
          if (
            trialEndDate < now &&
            subscriptionStatus !== "active" &&
            subscriptionStatus !== "trialing"
          ) {
            logger.warn(
              `User ${userId} attempted to login with expired trial organization ${
                orgData.organizationId
              }. Trial ended: ${trialEndDate.toISOString()}`
            );
            res.status(403).json({
              success: false,
              message:
                "TRIAL_EXPIRED: Your trial period has expired. Please contact the administrator to upgrade your subscription.",
              code: "TRIAL_EXPIRED",
            });
            return;
          }
        }
      }
      // If user has no organization, they're likely pending payment - allow access
    }

    // Get organization information from req.user (set by auth middleware)
    const organizationId = req.user?.organizationId;
    const organization = req.user?.organization;

    // Use the actual role from database, but override for superadmin/subadmin
    const userWithRole = {
      ...user,
      role: user.isSuperAdmin
        ? "superadmin"
        : user.subadminId
        ? "subadmin"
        : user.role || "user", // Use actual role from database
      organizationId: organizationId || null,
      organization: organization || null,
      demoOrgInfo: demoOrgInfo, // Include demo organization info
    };

    // logger.info(`User profile fetched for user: ${userId}`);
    // logger.info(`User isSuperAdmin: ${userWithRole.isSuperAdmin}`);
    // logger.info(`User role: ${userWithRole.role}`);
    logger.info(
      `User role from database: ${user.role}, Final role: ${userWithRole.role}`
    );
    logger.info(
      `User isSuperAdmin: ${user.isSuperAdmin}, subadminId: ${user.subadminId}`
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
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while fetching user profile",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Update user profile function has been moved to updateuserprofile.controller.ts
// to avoid duplication and use the more robust implementation with validation
