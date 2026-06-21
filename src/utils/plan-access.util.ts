import { database } from "@/configs/connection.config";
import {
  organizations,
  subscriptions,
  subscriptionPlans,
  userOrganizations,
  projects,
  clients,
  tasks,
  leadWebhooks,
  invoices,
  proposals,
} from "@/schema/schema";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export interface PlanFeatures {
  // Numeric limits (null/undefined/0 = unlimited)
  maxUsers?: number | null;
  maxProjects?: number | null;
  maxStorage?: number | null;
  maxTasks?: number | null;
  maxLeads?: number | null;
  maxClients?: number | null;
  maxWebhooks?: number | null;
  maxInvoices?: number | null;
  maxProposals?: number | null;
  aiTokenLimit?: number | null;
  // Boolean feature flags
  aiAssist?: boolean;
  prioritySupport?: boolean;
  calendarAccess?: boolean;
  taskManagement?: boolean;
  timeTracking?: boolean;
  analyticsAccess?: boolean;
  apiAccess?: boolean;
  paymentLinks?: boolean;
  proposalsAccess?: boolean;
  whitelabel?: boolean;
  customDomain?: boolean;
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
 * Get organization's effective plan features.
 * Hierarchy: org override > plan limit > null (unlimited).
 */
export async function getOrganizationPlanFeatures(
  organizationId: string
): Promise<PlanFeatures | null> {
  try {
    // Fetch org override columns alongside the active subscription's plan features
    const [orgRow] = await database
      .select({
        subscriptionPlanId: organizations.subscriptionPlanId,
        overrideMaxLeads: organizations.overrideMaxLeads,
        overrideMaxClients: organizations.overrideMaxClients,
        overrideMaxWebhooks: organizations.overrideMaxWebhooks,
        overrideMaxTasks: organizations.overrideMaxTasks,
        overrideMaxInvoices: organizations.overrideMaxInvoices,
        overrideMaxProposals: organizations.overrideMaxProposals,
        overrideAiTokenLimit: organizations.overrideAiTokenLimit,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    // Get plan features from active subscription
    let planFeatures: PlanFeatures | null = null;

    const subscription = await database
      .select({ features: subscriptionPlans.features })
      .from(subscriptions)
      .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
      .where(eq(subscriptions.organizationId, organizationId))
      .limit(1);

    if (subscription.length > 0 && subscription[0].features) {
      planFeatures = subscription[0].features as PlanFeatures;
    } else if (orgRow?.subscriptionPlanId) {
      // Fallback: read plan directly from org's subscriptionPlanId
      const [plan] = await database
        .select({ features: subscriptionPlans.features })
        .from(subscriptionPlans)
        .where(eq(subscriptionPlans.id, orgRow.subscriptionPlanId))
        .limit(1);
      if (plan?.features) planFeatures = plan.features as PlanFeatures;
    }

    // No plan and no overrides → null (no restrictions)
    const hasOverrides = orgRow && (
      orgRow.overrideMaxLeads !== null ||
      orgRow.overrideMaxClients !== null ||
      orgRow.overrideMaxWebhooks !== null ||
      orgRow.overrideMaxTasks !== null ||
      orgRow.overrideMaxInvoices !== null ||
      orgRow.overrideMaxProposals !== null ||
      orgRow.overrideAiTokenLimit !== null
    );

    if (!planFeatures && !hasOverrides) return null;

    // Merge: org overrides take precedence over plan values
    const effective: PlanFeatures = {
      ...(planFeatures ?? {}),
      maxLeads: orgRow?.overrideMaxLeads ?? planFeatures?.maxLeads,
      maxClients: orgRow?.overrideMaxClients ?? planFeatures?.maxClients,
      maxWebhooks: orgRow?.overrideMaxWebhooks ?? planFeatures?.maxWebhooks,
      maxTasks: orgRow?.overrideMaxTasks ?? planFeatures?.maxTasks,
      maxInvoices: orgRow?.overrideMaxInvoices ?? planFeatures?.maxInvoices,
      maxProposals: orgRow?.overrideMaxProposals ?? planFeatures?.maxProposals,
      aiTokenLimit: orgRow?.overrideAiTokenLimit ?? planFeatures?.aiTokenLimit,
    };

    return effective;
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

/**
 * Check if organization can upload file based on storage limit
 * @param organizationId - Organization ID
 * @param fileSizeInBytes - Size of file to upload in bytes
 * @returns PlanAccessResult with hasAccess, current storage usage, and max allowed
 */
export async function canUploadFile(
  organizationId: string,
  fileSizeInBytes: number
): Promise<PlanAccessResult> {
  try {
    const features = await getOrganizationPlanFeatures(organizationId);

    if (!features) {
      // No plan restrictions - allow upload
      return { hasAccess: true };
    }

    // If maxStorage is 0 or undefined, it means unlimited
    if (!features.maxStorage || features.maxStorage === 0) {
      return { hasAccess: true, planFeatures: features };
    }

    // Calculate current storage usage from projects
    // Get all projects for this organization and sum up their file sizes
    const orgProjects = await database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    // Sum all file sizes (in bytes) from projectFiles JSON field
    const currentStorageBytes = orgProjects.reduce((total, project) => {
      const projectFiles = (project as any).projectFiles;
      if (projectFiles && typeof projectFiles === "object") {
        // Get totalSize if available, otherwise sum individual file sizes
        if (projectFiles.totalSize) {
          return total + projectFiles.totalSize;
        }
        // Fallback: sum individual file sizes
        if (projectFiles.projectPdf?.size) {
          return total + projectFiles.projectPdf.size;
        }
      }
      return total;
    }, 0);

    // Convert maxStorage from GB to bytes (1 GB = 1024 * 1024 * 1024 bytes)
    const maxStorageBytes = features.maxStorage * 1024 * 1024 * 1024;
    const fileSizeInGB = fileSizeInBytes / (1024 * 1024 * 1024);
    const currentStorageInGB = currentStorageBytes / (1024 * 1024 * 1024);
    const maxStorageInGB = features.maxStorage;

    // Check if adding this file would exceed the limit
    if (currentStorageBytes + fileSizeInBytes > maxStorageBytes) {
      return {
        hasAccess: false,
        reason: `Storage limit reached. Your plan allows ${maxStorageInGB} GB storage. You are currently using ${currentStorageInGB.toFixed(
          2
        )} GB, and this file (${fileSizeInGB.toFixed(
          2
        )} GB) would exceed your limit. Please upgrade your plan or delete some files.`,
        currentCount: currentStorageInGB,
        maxAllowed: maxStorageInGB,
        planFeatures: features,
      };
    }

    return {
      hasAccess: true,
      currentCount: currentStorageInGB,
      maxAllowed: maxStorageInGB,
      planFeatures: features,
    };
  } catch (error) {
    logger.error("Error checking storage limit:", error);
    // On error, allow upload to avoid blocking users
    return { hasAccess: true };
  }
}

// ─── helper: count rows in a table by organizationId ─────────────────────────

async function countRows(
  table: any,
  orgColumn: any,
  organizationId: string,
  extraWhere?: any
): Promise<number> {
  const conditions = extraWhere
    ? and(eq(orgColumn, organizationId), extraWhere)
    : eq(orgColumn, organizationId);
  const [row] = await database
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(conditions);
  return Number(row?.count ?? 0);
}

// ─── numeric-limit enforcement factories ──────────────────────────────────────

function numericLimitCheck(
  limitKey: keyof PlanFeatures,
  entityLabel: string,
  counter: (orgId: string) => Promise<number>
) {
  return async function (organizationId: string): Promise<PlanAccessResult> {
    try {
      const features = await getOrganizationPlanFeatures(organizationId);
      if (!features) return { hasAccess: true };

      const max = features[limitKey] as number | null | undefined;
      if (!max || max === 0) return { hasAccess: true, planFeatures: features };

      const current = await counter(organizationId);
      if (current >= max) {
        return {
          hasAccess: false,
          reason: `${entityLabel} limit reached. Your plan allows ${max}, and you currently have ${current}.`,
          currentCount: current,
          maxAllowed: max,
          planFeatures: features,
        };
      }
      return { hasAccess: true, currentCount: current, maxAllowed: max, planFeatures: features };
    } catch (error) {
      logger.error(`Error checking ${entityLabel} limit:`, error);
      return { hasAccess: true };
    }
  };
}

export const canCreateLead = numericLimitCheck(
  "maxLeads",
  "Lead",
  (orgId) => countRows(clients, clients.organizationId, orgId, eq(clients.clientType, "lead"))
);

export const canCreateClient = numericLimitCheck(
  "maxClients",
  "Client",
  (orgId) => countRows(clients, clients.organizationId, orgId, eq(clients.clientType, "client"))
);

export const canCreateWebhook = numericLimitCheck(
  "maxWebhooks",
  "Webhook",
  (orgId) => countRows(leadWebhooks, leadWebhooks.orgId, orgId)
);

export const canCreateInvoice = numericLimitCheck(
  "maxInvoices",
  "Invoice",
  (orgId) => countRows(invoices, invoices.organizationId, orgId)
);

export const canCreateProposal = numericLimitCheck(
  "maxProposals",
  "Proposal",
  (orgId) => countRows(proposals, proposals.organizationId, orgId)
);

export const canCreateTask = numericLimitCheck(
  "maxTasks",
  "Task",
  async (orgId) => {
    const [row] = await database
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(projects.organizationId, orgId));
    return Number(row?.count ?? 0);
  }
);

/**
 * Get current storage usage for an organization
 * @param organizationId - Organization ID
 * @returns Storage usage in GB
 */
export async function getStorageUsage(
  organizationId: string
): Promise<{ usedGB: number; maxGB: number; percentage: number }> {
  try {
    const features = await getOrganizationPlanFeatures(organizationId);

    // Calculate current storage usage from projects
    const orgProjects = await database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    const currentStorageBytes = orgProjects.reduce((total, project) => {
      const projectFiles = (project as any).projectFiles;
      if (projectFiles && typeof projectFiles === "object") {
        // Get totalSize if available, otherwise sum individual file sizes
        if (projectFiles.totalSize) {
          return total + projectFiles.totalSize;
        }
        // Fallback: sum individual file sizes
        if (projectFiles.projectPdf?.size) {
          return total + projectFiles.projectPdf.size;
        }
      }
      return total;
    }, 0);

    const usedGB = currentStorageBytes / (1024 * 1024 * 1024);
    const maxGB = features?.maxStorage || 0;
    const percentage = maxGB > 0 ? (usedGB / maxGB) * 100 : 0;

    return {
      usedGB: parseFloat(usedGB.toFixed(2)),
      maxGB: maxGB,
      percentage: parseFloat(percentage.toFixed(2)),
    };
  } catch (error) {
    logger.error("Error getting storage usage:", error);
    return { usedGB: 0, maxGB: 0, percentage: 0 };
  }
}
