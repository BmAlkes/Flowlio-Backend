import { Request, Response, NextFunction } from "express";
import { hasFeatureAccess } from "@/utils/plan-access.util";
import { logger } from "@/utils/logger.util";

const FEATURE_LABELS: Record<string, string> = {
  analyticsAccess: "Reports & Analytics",
  apiAccess: "API & Webhooks",
  paymentLinks: "Payment Links",
  proposalsAccess: "Proposals",
  whitelabel: "White-label",
  aiAssist: "AI Assistance",
  calendarAccess: "Calendar",
  taskManagement: "Task Management",
  timeTracking: "Time Tracking",
};

/**
 * Middleware to check if organization has access to a specific plan feature.
 * - Superadmins bypass all feature checks.
 * - Hierarchy: org override → plan value → false (blocked).
 * - Org with no active plan → blocked (treated as false).
 * - Plan without the field in JSONB → blocked (false by default).
 */
export const requirePlanFeature = (featureName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = req.user as any;

      // Superadmins are never blocked by feature flags
      if (user?.role === "superadmin" || user?.isSuperAdmin === true) {
        next();
        return;
      }

      const organizationId = user?.organizationId;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          error: "ORGANIZATION_REQUIRED",
          message: "Organization ID is required",
        });
        return;
      }

      const accessCheck = await hasFeatureAccess(organizationId, featureName as any);

      if (!accessCheck.hasAccess) {
        const label = FEATURE_LABELS[featureName] ?? featureName;
        logger.warn(`Feature blocked: ${featureName} for org ${organizationId}`);
        res.status(403).json({
          success: false,
          error: "FEATURE_NOT_AVAILABLE",
          message: `Your plan does not include access to ${label}.`,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error(`Error checking plan feature ${featureName}:`, error);
      res.status(503).json({
        success: false,
        error: "SERVICE_UNAVAILABLE",
        message: "Unable to verify plan access. Please try again.",
      });
    }
  };
};
