import { Request, Response } from "express";
import {
  canCreateUser,
  canCreateProject,
  hasFeatureAccess,
} from "@/utils/plan-access.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";

/**
 * Check if organization can create more users
 */
export const checkCanCreateUser = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const result = await canCreateUser(organizationId);

    res.status(status.OK).json({
      success: true,
      data: result,
      message: result.hasAccess
        ? "User creation is allowed"
        : "User creation limit reached",
    });
  } catch (error) {
    logger.error("Error checking user creation access:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to check user creation access",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Check if organization can create more projects
 */
export const checkCanCreateProject = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;

    if (!organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const result = await canCreateProject(organizationId);

    res.status(status.OK).json({
      success: true,
      data: result,
      message: result.hasAccess
        ? "Project creation is allowed"
        : "Project creation limit reached",
    });
  } catch (error) {
    logger.error("Error checking project creation access:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to check project creation access",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

/**
 * Check if organization has access to a specific feature
 */
export const checkFeatureAccess = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const organizationId = (req.user as any)?.organizationId;
    const { featureName } = req.params;

    if (!organizationId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    if (!featureName) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Feature name is required",
      });
      return;
    }

    const result = await hasFeatureAccess(organizationId, featureName as any);

    res.status(status.OK).json({
      success: true,
      data: result,
      message: result.hasAccess
        ? `Feature ${featureName} is available`
        : `Feature ${featureName} is not available in your plan`,
    });
  } catch (error) {
    logger.error("Error checking feature access:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to check feature access",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
