import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  organizations,
  userOrganizations,
  users,
  subscriptions,
  subscriptionPlans,
} from "@/schema/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export const getCompanyDetails = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

    // Get organization details
    const organization = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization.length) {
      return res.status(404).json({
        success: false,
        message: "Organization not found",
      });
    }

    // Get organization users/employees
    const organizationUsers = await database
      .select({
        id: userOrganizations.id,
        userId: userOrganizations.userId,
        role: userOrganizations.role,
        status: userOrganizations.status,
        joinedAt: userOrganizations.joinedAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
        },
      })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId))
      .orderBy(userOrganizations.createdAt);

    // Get subscription details
    const subscription = await database
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        plan: {
          id: subscriptionPlans.id,
          name: subscriptionPlans.name,
          price: subscriptionPlans.price,
          description: subscriptionPlans.description,
        },
      })
      .from(subscriptions)
      .leftJoin(
        subscriptionPlans,
        eq(subscriptions.planId, subscriptionPlans.id)
      )
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1);

    // Get organization owner (by role = 'org' | fallback 'user')
    const ownerQuery = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
      })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(
        and(
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.role, "org")
        )
      )
      .limit(1);

    let owner = ownerQuery.length ? ownerQuery[0] : null;
    if (!owner) {
      const fallbackOwner = await database
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        })
        .from(userOrganizations)
        .innerJoin(users, eq(userOrganizations.userId, users.id))
        .where(
          and(
            eq(userOrganizations.organizationId, organizationId),
            eq(userOrganizations.role, "user")
          )
        )
        .limit(1);
      owner = fallbackOwner.length ? fallbackOwner[0] : null;
    }

    // Calculate stats
    const totalEmployees = organizationUsers.length;
    const activeEmployees = organizationUsers.filter(
      (user) => user.status === "active"
    ).length;
    const totalRevenue =
      subscription.length > 0 ? subscription[0].plan?.price || 0 : 0;

    const companyDetails = {
      organization: organization[0],
      users: organizationUsers,
      subscription: subscription.length > 0 ? subscription[0] : null,
      owner,
      stats: {
        totalEmployees,
        activeEmployees,
        totalRevenue,
        activeProjects: 0, // You can add this from projects table if needed
      },
    };

    logger.info(`Company details fetched for organization ${organizationId}`);

    return res.status(200).json({
      success: true,
      data: companyDetails,
      message: "Company details retrieved successfully",
    });
  } catch (error) {
    logger.error("Get company details error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get company details",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
