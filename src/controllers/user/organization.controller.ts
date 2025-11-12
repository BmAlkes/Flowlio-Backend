import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import {
  organizations,
  userOrganizations,
  subscriptions,
} from "@/schema/schema";
import crypto from "crypto";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
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
    const {
      userId,
      organizationName,
      organizationWebsite,
      organizationIndustry,
      organizationSize,
      planId,
    }: CreateOrganizationWithPlanRequest = req.body;

    // Validate required fields
    if (!userId || !organizationName || !planId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: userId, organizationName, planId",
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

    // Create organization slug from name
    const slug = organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    // Check if slug already exists
    const existingOrg = await database.query.organizations.findFirst({
      where: (orgs, { eq }) => eq(orgs.slug, slug),
    });

    if (existingOrg) {
      return res.status(409).json({
        success: false,
        message: "An organization with this name already exists",
      });
    }

    // Create organization
    const organizationId = crypto.randomUUID().replace(/-/g, "");
    const now = new Date();

    // Calculate trial end date (7 days from now)
    const trialEndsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Calculate subscription period (monthly billing cycle)
    const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days from now

    const newOrganization = await database
      .insert(organizations)
      .values({
        id: organizationId,
        name: organizationName,
        slug: slug,
        description: `${organizationName} organization`,
        website: organizationWebsite,
        industry: organizationIndustry,
        size: organizationSize,
        subscriptionPlanId: planId,
        subscriptionStatus: "active",
        subscriptionStartDate: now,
        trialEndsAt: trialEndsAt,
        maxUsers: plan.features?.maxUsers || 5,
        maxProjects: plan.features?.maxProjects || 3,
        maxStorage: plan.features?.maxStorage || 1,
        settings: {
          timezone: "UTC",
          dateFormat: "MM/DD/YYYY",
          currency: "USD",
          language: "en",
          notifications: {
            email: true,
            push: false,
            sms: false,
          },
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create subscription record
    const subscriptionId = crypto.randomUUID().replace(/-/g, "");
    const newSubscription = await database
      .insert(subscriptions)
      .values({
        id: subscriptionId,
        organizationId: organizationId,
        planId: planId,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: currentPeriodEnd,
        cancelAtPeriodEnd: false,
        trialStart: now,
        trialEnd: trialEndsAt,
        stripeSubscriptionId: null, // Will be set when integrating with Stripe
        stripeCustomerId: null, // Will be set when integrating with Stripe
        metadata: {
          createdBy: userId,
          organizationName: organizationName,
          demoPurchase: true,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create user-organization relationship (user as owner)
    const userOrgId = crypto.randomUUID().replace(/-/g, "");
    await database.insert(userOrganizations).values({
      id: userOrgId,
      userId: userId,
      organizationId: organizationId,
      role: "owner",
      status: "active",
      permissions: {
        canManageUsers: true,
        canManageProjects: true,
        canManageBilling: true,
        canViewAnalytics: true,
        canInviteUsers: true,
      },
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    logger.info(
      `Organization created: ${organizationId} for user: ${userId} with subscription: ${subscriptionId}`
    );

    // Get user info for notifications
    const user = await database.query.users.findFirst({
      where: (users, { eq }) => eq(users.id, userId),
      columns: {
        name: true,
        email: true,
      },
    });

    // Get plan info
    const planName = plan.name || "Unknown Plan";

    // Notify super admins about new company registration (non-blocking)
    notifySuperAdmins({
      type: "newCompany",
      title: "New Company Registration",
      message: `A new company "${organizationName}" has been registered on Flowlio.`,
      details: {
        "Company Name": organizationName,
        Owner: user?.name || user?.email || "Unknown",
        "Owner Email": user?.email || "Unknown",
        Plan: planName,
        "Registration Date": new Date().toLocaleString(),
      },
    }).catch((error) => {
      logger.error("Failed to send new company notification:", error);
    });

    // Notify super admins about user subscription (non-blocking)
    notifySuperAdmins({
      type: "userSubscribe",
      title: "User Subscription",
      message: `A user has subscribed to the "${planName}" plan.`,
      details: {
        User: user?.name || user?.email || "Unknown",
        "User Email": user?.email || "Unknown",
        Plan: planName,
        Company: organizationName,
        "Subscription Date": new Date().toLocaleString(),
      },
    }).catch((error) => {
      logger.error("Failed to send subscription notification:", error);
    });

    return res.status(201).json({
      success: true,
      message: "Organization created successfully with plan and subscription",
      data: {
        organization: newOrganization[0],
        subscription: newSubscription[0],
        plan: plan,
        userRole: "owner",
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
