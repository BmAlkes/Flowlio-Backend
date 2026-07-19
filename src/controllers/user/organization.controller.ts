import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import { eq } from "drizzle-orm";
import { users } from "@/schema/schema";
interface CreateOrganizationWithPlanRequest {
  userId: string;
  organizationName: string;
  organizationWebsite?: string;
  organizationIndustry?: string;
  organizationSize?: string;
  planId: string;
}

export const createOrganizationWithPlan = async (
  req: Request,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    const {
      organizationName,
      organizationWebsite,
      organizationIndustry,
      organizationSize,
      planId,
    }: Omit<CreateOrganizationWithPlanRequest, "userId"> = req.body;

    // Validate required fields
    if (!userId || !organizationName || !planId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: organizationName, planId",
      });
    }

    // Verify the plan exists and is active
    const plan = await database.query.subscriptionPlans.findFirst({
      where: (plans, { eq, and }) =>
        and(eq(plans.id, planId), eq(plans.isActive, true)),
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Selected plan not found or inactive",
      });
    }

    // Check if user exists and is pending
    const user = await database.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Allow multiple organizations with same name - slug will be made unique with user ID
    // No need to check for duplicates here since slug includes user ID in payment controller
    // This allows multiple users to have organizations with the same name

    // Store plan selection and organization data in user record (pending until payment)
    // Organization will be created after payment is completed
    await database
      .update(users)
      .set({
        selectedPlanId: planId,
        pendingOrganizationData: {
          organizationName,
          organizationWebsite,
          organizationIndustry,
          organizationSize,
          planId,
        },
      })
      .where(eq(users.id, userId));

    logger.info(
      `Plan selected and organization data stored for user: ${userId}. Organization will be created after payment.`
    );

    // Notify super admins about pending payment user
    try {
      const user = await database.query.users.findFirst({
        where: (t, { eq }) => eq(t.id, userId),
        columns: {
          id: true,
          name: true,
          email: true,
          status: true,
          selectedPlanId: true,
          pendingOrganizationData: true,
          createdAt: true,
        },
      });

      if (user && (user.status === "pending" || !user.status)) {
        await notifySuperAdmins({
          type: "pendingPayment",
          title: "New User Created - Payment Pending",
          message: `A new user "${user.name}" (${user.email}) has created an account but hasn't completed payment yet.`,
          details: {
            userId: user.id,
            userName: user.name,
            userEmail: user.email,
            selectedPlanId: user.selectedPlanId || "Not selected",
            organizationName:
              (user.pendingOrganizationData as any)?.organizationName ||
              "Not provided",
            createdAt:
              user.createdAt?.toISOString() || new Date().toISOString(),
          },
        });
        logger.info(
          `Notification sent to super admins about pending payment user: ${user.email}`
        );
      }
    } catch (notificationError) {
      logger.error(
        "Error sending notification about pending payment user:",
        notificationError
      );
      // Don't fail the request if notification fails
    }

    // Get plan info
    // const planName = plan.name || "Unknown Plan";

    return res.status(200).json({
      success: true,
      message:
        "Plan selected successfully. Please complete payment to create your organization and activate your account.",
      data: {
        plan: plan,
        pendingOrganizationData: {
          organizationName,
          organizationWebsite,
          organizationIndustry,
          organizationSize,
        },
      },
    });
  } catch (error) {
    logger.error("Error creating organization with plan:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while creating organization",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Get user's organizations
export const getUserOrganizations = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    logger.info(`Fetching organizations for user: ${userId}`);

    const userOrgs = await database.query.userOrganizations.findMany({
      where: (userOrgs, { eq }) => eq(userOrgs.userId, userId),
      with: {
        organization: {
          with: {
            subscriptionPlan: true,
            subscriptions: true,
            userOrganizations: true,
          },
        },
      },
    });

    logger.info(
      `Found ${userOrgs.length} user organizations for user: ${userId}`
    );

    // Debug: Log the actual data
    if (userOrgs.length > 0) {
      logger.info(
        "User organizations data:",
        JSON.stringify(userOrgs, null, 2)
      );
    }

    return res.status(200).json({
      success: true,
      message: "User organizations retrieved successfully",
      data: userOrgs,
    });
  } catch (error) {
    logger.error("Error retrieving user organizations:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving organizations",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Get user's subscriptions
export const getUserSubscriptions = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get user's organizations first
    const userOrgs = await database.query.userOrganizations.findMany({
      where: (userOrgs, { eq }) => eq(userOrgs.userId, userId),
      with: {
        organization: {
          with: {
            subscriptions: {
              with: {
                plan: true,
              },
            },
          },
        },
      },
    });

    // Extract subscriptions from organizations
    const subscriptions = userOrgs.flatMap((userOrg) =>
      userOrg.organization.subscriptions.map((subscription) => ({
        ...subscription,
        organization: userOrg.organization,
        userRole: userOrg.role,
      }))
    );

    return res.status(200).json({
      success: true,
      message: "User subscriptions retrieved successfully",
      data: subscriptions,
    });
  } catch (error) {
    logger.error("Error retrieving user subscriptions:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving subscriptions",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
