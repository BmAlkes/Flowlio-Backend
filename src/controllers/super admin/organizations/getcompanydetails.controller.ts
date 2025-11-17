import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  organizations,
  userOrganizations,
  users,
  subscriptions,
  subscriptionPlans,
  projects,
} from "@/schema/schema";
import { and, eq, or } from "drizzle-orm";
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
        createdAt: userOrganizations.createdAt, // Use this as fallback for joinedAt
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          phone: users.phone,
          address: users.address,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
        },
      })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(eq(userOrganizations.organizationId, organizationId))
      .orderBy(userOrganizations.createdAt);

    // Check if organization is a demo organization
    const isDemoOrg = organization[0]?.settings?.demo === true;
    const organizationEmail = (organization[0] as any)?.email || null;

    // Get subscription details with plan features
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
          features: subscriptionPlans.features,
          customPlanName: subscriptionPlans.customPlanName,
          slug: subscriptionPlans.slug,
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
        phone: users.phone,
        address: users.address,
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
          phone: users.phone,
          address: users.address,
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

    // Get active projects count
    const activeProjectsQuery = await database
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.organizationId, organizationId),
          or(
            eq(projects.status, "ongoing"),
            eq(projects.status, "pending")
          )
        )
      );
    
    const activeProjectsCount = activeProjectsQuery.length;

    // Calculate stats
    const totalEmployees = organizationUsers.length;
    const activeEmployees = organizationUsers.filter(
      (user) => user.status === "active"
    ).length;
    const totalRevenue =
      subscription.length > 0 ? subscription[0].plan?.price || 0 : 0;

    // Format users data - for demo users, show organization email and ensure joinedAt is properly formatted
    const formattedUsers = organizationUsers.map((user) => {
      // Ensure joinedAt is properly formatted as ISO string
      // Use joinedAt if available, otherwise fallback to createdAt (when user was added to org)
      // or user.createdAt (when user account was created)
      let dateToUse = user.joinedAt || user.createdAt || user.user.createdAt;
      let formattedJoinedAt: string | null = null;

      if (dateToUse) {
        try {
          // If it's already a Date object, convert to ISO string
          if (dateToUse instanceof Date) {
            formattedJoinedAt = dateToUse.toISOString();
          } else if (typeof dateToUse === "string") {
            // If it's a string, parse and format it
            const parsedDate = new Date(dateToUse);
            // Check if date is valid (not epoch date)
            if (!isNaN(parsedDate.getTime()) && parsedDate.getTime() > 0) {
              formattedJoinedAt = parsedDate.toISOString();
            } else {
              // Invalid date, use createdAt as fallback
              const fallbackDate = user.createdAt || user.user.createdAt;
              if (fallbackDate) {
                formattedJoinedAt = new Date(fallbackDate).toISOString();
              }
            }
          } else {
            // Fallback: convert to string if it's another type
            formattedJoinedAt = String(dateToUse);
          }
        } catch (error) {
          logger.warn(
            `Error formatting joinedAt for user ${user.userId}:`,
            error
          );
          // Use createdAt as fallback if formatting fails
          const fallbackDate = user.createdAt || user.user.createdAt;
          if (fallbackDate) {
            try {
              formattedJoinedAt = new Date(fallbackDate).toISOString();
            } catch (e) {
              formattedJoinedAt = null;
            }
          }
        }
      }

      // For demo users, prefer organization email if available
      const displayEmail =
        isDemoOrg && organizationEmail ? organizationEmail : user.user.email;

      return {
        id: user.id,
        userId: user.userId,
        role: user.role,
        status: user.status,
        joinedAt: formattedJoinedAt,
        user: {
          id: user.user.id,
          name: user.user.name,
          email: displayEmail,
          image: user.user.image,
          phone: user.user.phone,
          address: user.user.address,
          emailVerified: user.user.emailVerified,
          createdAt: user.user.createdAt,
        },
      };
    });

    const companyDetails = {
      organization: organization[0],
      users: formattedUsers,
      subscription: subscription.length > 0 ? subscription[0] : null,
      owner,
      stats: {
        totalEmployees,
        activeEmployees,
        totalRevenue,
        activeProjects: activeProjectsCount,
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
