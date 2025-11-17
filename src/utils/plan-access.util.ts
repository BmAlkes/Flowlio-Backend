import { database } from "@/configs/connection.config";
import {
  organizations,
  subscriptions,
  subscriptionPlans,
  userOrganizations,
  projects,
} from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export interface PlanFeatures {
  maxUsers?: number;
  maxProjects?: number;
  maxStorage?: number;
  maxTasks?: number;
  aiAssist?: boolean;
  prioritySupport?: boolean;
  calendarAccess?: boolean;
  taskManagement?: boolean;
  timeTracking?: boolean;
  customFeatures?: string[];
  [key: string]: any;
}

export interface PlanAccessResult {
  hasAccess: boolean;
  reason?: string;
  currentCount?: number;
  maxAllowed?: number;
  planFeatures?: PlanFeatures;
}

/**
 * Get organization's plan features
 */
export async function getOrganizationPlanFeatures(
  organizationId: string
): Promise<PlanFeatures | null> {
  try {
    // Get active subscription
    const subscription = await database
      .select({
        plan: {
          features: subscriptionPlans.features,
        },
      })
      .from(subscriptions)
      .leftJoin(
        subscriptionPlans,
        eq(subscriptions.planId, subscriptionPlans.id)
      )
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1);

    if (subscription.length > 0 && subscription[0].plan?.features) {
      return subscription[0].plan.features as PlanFeatures;
    }

    // Fallback: Get plan from organization's subscriptionPlanId
    const org = await database
      .select({
        subscriptionPlanId: organizations.subscriptionPlanId,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (org.length > 0 && org[0].subscriptionPlanId) {
      const plan = await database
        .select({
          features: subscriptionPlans.features,
        })
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, org[0].subscriptionPlanId))
        .limit(1);

      if (plan.length > 0 && plan[0].features) {
        return plan[0].features as PlanFeatures;
      }
    }

    return null;
  } catch (error) {
    logger.error("Error getting organization plan features:", error);
    return null;
  }
}

/**
 * Check if organization can create more users based on plan limit
 */
export async function canCreateUser(
  organizationId: string
): Promise<PlanAccessResult> {
  try {
    const features = await getOrganizationPlanFeatures(organizationId);

    if (!features) {
      // No plan restrictions - allow creation
      return { hasAccess: true };
    }

    // If maxUsers is 0 or undefined, it means unlimited
    if (!features.maxUsers || features.maxUsers === 0) {
      return { hasAccess: true, planFeatures: features };
    }

    // Count current active users in organization
    const currentUsers = await database
      .select()
      .from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId));

    const activeUsersCount = currentUsers.filter(
      (u) => u.status === "active"
    ).length;

    const maxUsers = features.maxUsers;

    if (activeUsersCount >= maxUsers) {
      return {
        hasAccess: false,
        reason: `User limit reached. Your plan allows ${maxUsers} users, and you currently have ${activeUsersCount} active users.`,
        currentCount: activeUsersCount,
        maxAllowed: maxUsers,
        planFeatures: features,
      };
    }

    return {
      hasAccess: true,
      currentCount: activeUsersCount,
      maxAllowed: maxUsers,
      planFeatures: features,
    };
  } catch (error) {
    logger.error("Error checking user creation limit:", error);
    // On error, allow creation to avoid blocking users
    return { hasAccess: true };
  }
}

/**
 * Check if organization can create more projects based on plan limit
 */
export async function canCreateProject(
  organizationId: string
): Promise<PlanAccessResult> {
  try {
    const features = await getOrganizationPlanFeatures(organizationId);

    if (!features) {
      return { hasAccess: true };
    }

    if (!features.maxProjects || features.maxProjects === 0) {
      return { hasAccess: true, planFeatures: features };
    }

    // Count current projects
    const currentProjects = await database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    const projectsCount = currentProjects.length;
    const maxProjects = features.maxProjects;

    if (projectsCount >= maxProjects) {
      return {
        hasAccess: false,
        reason: `Project limit reached. Your plan allows ${maxProjects} projects, and you currently have ${projectsCount} projects.`,
        currentCount: projectsCount,
        maxAllowed: maxProjects,
        planFeatures: features,
      };
    }

    return {
      hasAccess: true,
      currentCount: projectsCount,
      maxAllowed: maxProjects,
      planFeatures: features,
    };
  } catch (error) {
    logger.error("Error checking project creation limit:", error);
    return { hasAccess: true };
  }
}

/**
 * Check if organization has access to a specific feature
 */
export async function hasFeatureAccess(
  organizationId: string,
  featureName: keyof PlanFeatures
): Promise<PlanAccessResult> {
  try {
    const features = await getOrganizationPlanFeatures(organizationId);

    if (!features) {
      // No plan restrictions - allow access
      return { hasAccess: true };
    }

    const hasAccess = features[featureName] === true;

    if (!hasAccess) {
      return {
        hasAccess: false,
        reason: `This feature is not available in your current plan. Please upgrade to access ${featureName}.`,
        planFeatures: features,
      };
    }

    return {
      hasAccess: true,
      planFeatures: features,
    };
  } catch (error) {
    logger.error(`Error checking feature access for ${featureName}:`, error);
    // On error, allow access to avoid blocking users
    return { hasAccess: true };
  }
}
