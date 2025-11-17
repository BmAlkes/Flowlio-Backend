import { Request, Response, NextFunction } from "express";
import { hasFeatureAccess } from "@/utils/plan-access.util";
import { logger } from "@/utils/logger.util";

/**
 * Middleware to check if organization has access to a specific plan feature
 */
export const requirePlanFeature = (featureName: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = (req.user as any)?.organizationId;

      if (!organizationId) {
        res.status(400).json({
          success: false,
          message: "Organization ID is required",
        });
        return;
      }

      const accessCheck = await hasFeatureAccess(
        organizationId,
        featureName as any
      );

      if (!accessCheck.hasAccess) {
        logger.warn(
          `⚠️ Feature access denied: ${featureName} for organization ${organizationId}`
        );
        res.status(403).json({
          success: false,
          message:
            accessCheck.reason ||
            `This feature is not available in your current plan. Please upgrade to access ${featureName}.`,
          data: {
            feature: featureName,
            planFeatures: accessCheck.planFeatures,
          },
        });
        return;
      }

      next();
    } catch (error) {
      logger.error(`Error checking plan feature ${featureName}:`, error);
      // On error, allow access to avoid blocking users
      next();
    }
  };
};
