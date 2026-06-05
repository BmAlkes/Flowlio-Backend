import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";

// GET All organizations and pending users (users who signed up but haven't paid)
export const getAllOrganizations = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user || (user.role !== "superadmin" && !user.isSuperAdmin)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Get all organizations with their users
    const allOrgs = await database.query.organizations.findMany({
      with: {
        userOrganizations: {
          with: {
            user: {
              columns: {
                id: true,
                name: true,
                email: true,
                status: true, // Include user status (pending/active)
                selectedPlanId: true, // Include selected plan ID
                pendingOrganizationData: true, // Include pending organization data
                isSuperAdmin: true,
                createdAt: true,
              },
            },
          },
        },
        subscriptionPlan: true,
        subscriptions: {
          // Get all subscriptions (active and non-active) for superadmin view
          // We'll filter in the frontend to show both
        },
      },
    });

    // Sort subscriptions by createdAt descending and take the most recent one for each org
    // This ensures we get the price from the subscription that was actually paid for
    const orgsWithSortedSubscriptions = allOrgs.map((org) => {
      if (org.subscriptions && org.subscriptions.length > 0) {
        // Sort subscriptions by createdAt descending and take the first (most recent)
        const sortedSubs = [...org.subscriptions].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        return {
          ...org,
          subscriptions: [sortedSubs[0]], // Keep only the most recent subscription
          // Ensure subscriptionStatus is explicitly included
          subscriptionStatus: org.subscriptionStatus || "non active",
        };
      }
      return {
        ...org,
        // Ensure subscriptionStatus is explicitly included even if no subscriptions
        subscriptionStatus: org.subscriptionStatus || "non active",
      };
    });

    // Get all users with pending status
    let allPendingUsers: any[] = [];
    let pendingUsersWithoutOrg: any[] = [];
    let subscriptionPlans: any[] = [];

    try {
      // First, get all pending users
      allPendingUsers = await database.query.users.findMany({
        where: (users, { eq, and, or, isNull }) =>
          and(
            eq(users.isSuperAdmin, false), // Exclude super admins
            or(eq(users.status, "pending"), isNull(users.status)) // Users with pending status or no status
          ),
        columns: {
          id: true,
          name: true,
          email: true,
          status: true,
          selectedPlanId: true,
          pendingOrganizationData: true,
          isSuperAdmin: true,
          createdAt: true,
        },
      });

      // Get all user-organization relationships for these users
      const userIds = allPendingUsers.map((u) => u.id);
      let userOrgMap = new Map<string, boolean>();

      if (userIds.length > 0) {
        try {
          const userOrgs = await database.query.userOrganizations.findMany({
            where: (uo, { inArray }) => inArray(uo.userId, userIds),
            columns: {
              userId: true,
            },
          });

          // Create a map of users who have organizations
          userOrgs.forEach((uo) => {
            userOrgMap.set(uo.userId, true);
          });
        } catch (userOrgError) {
          logger.error("Error fetching user organizations:", userOrgError);
          // Continue with empty map if query fails
        }
      }

      // Filter users who don't have any organization
      // These are users who signed up but haven't completed payment yet
      pendingUsersWithoutOrg = allPendingUsers.filter(
        (user) => !userOrgMap.has(user.id)
      );

      logger.info(
        `Found ${pendingUsersWithoutOrg.length} pending users without organizations (out of ${allPendingUsers.length} total pending users)`
      );
    } catch (pendingUsersError) {
      logger.error("Error fetching pending users:", pendingUsersError);
      logger.error("Pending users error details:", {
        message:
          pendingUsersError instanceof Error
            ? pendingUsersError.message
            : String(pendingUsersError),
        stack:
          pendingUsersError instanceof Error
            ? pendingUsersError.stack
            : undefined,
      });
      // Continue without pending users if query fails
      pendingUsersWithoutOrg = [];
    }

    try {
      // Get subscription plans for pending users
      subscriptionPlans = await database.query.subscriptionPlans.findMany({
        columns: {
          id: true,
          name: true,
          price: true,
          slug: true,
          description: true,
        },
      });
    } catch (plansError) {
      logger.error("Error fetching subscription plans:", plansError);
      // Continue with empty plans array if query fails
      subscriptionPlans = [];
    }

    // Create virtual "organizations" for pending users without organizations
    // This allows them to appear in the companies table
    const pendingUserOrgs = pendingUsersWithoutOrg.map((user) => {
      const pendingData = user.pendingOrganizationData as {
        organizationName?: string;
        organizationWebsite?: string;
        organizationIndustry?: string;
        organizationSize?: string;
        planId?: string;
      } | null;

      // Find the plan for this user
      const planId = user.selectedPlanId || pendingData?.planId;
      const plan = planId
        ? subscriptionPlans.find((p) => p.id === planId)
        : null;

      return {
        id: `pending_${user.id}`, // Virtual ID for pending users
        name:
          pendingData?.organizationName || user.name || "Pending Organization",
        slug: `pending-${user.id}`,
        description: null,
        website: pendingData?.organizationWebsite || null,
        industry: pendingData?.organizationIndustry || null,
        size: pendingData?.organizationSize || null,
        subscriptionPlanId: planId || null,
        subscriptionStatus: "non active", // Mark as non-active since payment is pending
        subscriptionStartDate: null,
        trialEndsAt: null,
        maxUsers: 0,
        maxProjects: 0,
        maxStorage: 0,
        settings: null,
        createdAt: user.createdAt,
        updatedAt: user.createdAt,
        subscriptionPlan: plan || null,
        subscriptions: [],
        userOrganizations: [
          {
            id: `pending_uo_${user.id}`,
            userId: user.id,
            organizationId: `pending_${user.id}`,
            role: "owner",
            status: "active",
            permissions: null,
            joinedAt: user.createdAt,
            createdAt: user.createdAt,
            updatedAt: user.createdAt,
            user: {
              id: user.id,
              name: user.name,
              email: user.email,
              status: user.status || "pending",
              selectedPlanId: user.selectedPlanId,
              pendingOrganizationData: user.pendingOrganizationData,
              isSuperAdmin: user.isSuperAdmin,
              createdAt: user.createdAt,
            },
          },
        ],
      };
    });

    // Combine real organizations with pending user "organizations"
    const allData = [...orgsWithSortedSubscriptions, ...pendingUserOrgs];

    logger.info(
      `Total organizations: ${orgsWithSortedSubscriptions.length}, Pending users without org: ${pendingUsersWithoutOrg.length}, Total entries: ${allData.length}`
    );

    return res.status(200).json({
      success: true,
      message: "All organizations and pending users retrieved successfully",
      data: allData,
    });
  } catch (error) {
    logger.error("Error retrieving all organizations:", error);
    logger.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      error: error,
    });
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving organizations",
      error:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? {
                message: error.message,
                stack: error.stack,
              }
            : String(error)
          : undefined,
    });
  }
};
