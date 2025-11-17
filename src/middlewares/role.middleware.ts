import { Request, Response, NextFunction } from "express";
import { logger } from "@/utils/logger.util";

// Define user roles - aligned with frontend
export const USER_ROLES = {
  SUPER_ADMIN: "superadmin",
  SUB_ADMIN: "subadmin",
  USER: "user",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// Role hierarchy (higher number = more permissions)
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [USER_ROLES.USER]: 1,
  [USER_ROLES.SUB_ADMIN]: 2,
  [USER_ROLES.SUPER_ADMIN]: 3,
};

// Check if user has required role or higher
export const hasRole = (
  userRole: UserRole,
  requiredRole: UserRole
): boolean => {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
};

// Middleware to check if user has required role
export const requireRole = (requiredRole: UserRole) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        logger.warn("Role check failed: No user in request");
        res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required",
        });
        return;
      }

      const userRole = req.user.role as UserRole;

      if (!userRole) {
        logger.warn("Role check failed: No role found for user", {
          userId: req.user.id,
        });
        res.status(403).json({
          error: "Forbidden",
          message: "User role not defined",
        });
        return;
      }

      if (!hasRole(userRole, requiredRole)) {
        logger.warn("Role check failed: Insufficient permissions", {
          userId: req.user.id,
          userRole,
          requiredRole,
        });
        res.status(403).json({
          error: "Forbidden",
          message: `Insufficient permissions. Required role: ${requiredRole}`,
        });
        return;
      }

      logger.info("Role check passed", {
        userId: req.user.id,
        userRole,
        requiredRole,
      });

      next();
    } catch (error) {
      logger.error("Role check error:", error);
      res.status(500).json({
        error: "Internal server error",
        message: "Failed to verify user role",
      });
    }
  };
};

// Middleware to check if user is super admin
export const requireSuperAdmin = requireRole(USER_ROLES.SUPER_ADMIN);

// Middleware to check if user is sub admin or higher (allows both subadmin and superadmin)
export const requireSubAdmin = requireRole(USER_ROLES.SUB_ADMIN);

// Middleware to check if user is super admin or sub admin (explicit check for both)
export const requireSuperOrSubAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      logger.warn("Role check failed: No user in request");
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

    const userRole = req.user.role as UserRole;

    if (!userRole) {
      logger.warn("Role check failed: No role found for user", {
        userId: req.user.id,
      });
      res.status(403).json({
        error: "Forbidden",
        message: "User role not defined",
      });
      return;
    }

    // Allow both superadmin and subadmin
    if (
      userRole !== USER_ROLES.SUPER_ADMIN &&
      userRole !== USER_ROLES.SUB_ADMIN
    ) {
      logger.warn("Role check failed: User must be superadmin or subadmin", {
        userId: req.user.id,
        userRole,
      });
      res.status(403).json({
        error: "Forbidden",
        message: "Access restricted to super admin or sub admin",
      });
      return;
    }

    logger.info("Super/Sub admin check passed", {
      userId: req.user.id,
      userRole,
    });

    next();
  } catch (error) {
    logger.error("Role check error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to verify user role",
    });
  }
};

// Middleware to check if user is regular user or higher (all authenticated users)
export const requireUser = requireRole(USER_ROLES.USER);

// Legacy aliases for backward compatibility
export const requireAdmin = requireRole(USER_ROLES.SUB_ADMIN);
export const requireMember = requireRole(USER_ROLES.USER);
export const requireViewer = requireRole(USER_ROLES.USER);

// Middleware to check if user belongs to organization
export const requireOrganizationAccess = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
      return;
    }

    if (!req.user.organizationId) {
      logger.warn(
        "Organization access check failed: User not in organization",
        {
          userId: req.user.id,
        }
      );
      res.status(403).json({
        error: "Forbidden",
        message: "Organization access required",
      });
      return;
    }

    next();
  } catch (error) {
    logger.error("Organization access check error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Failed to verify organization access",
    });
  }
};
