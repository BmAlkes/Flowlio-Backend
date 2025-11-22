import { Request, Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import { subscriptions, organizations } from "@/schema/schema";
import { eq, and, gte } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string;
    isSuperAdmin: boolean;
    subadminId?: string;
    createdAt: Date;
    updatedAt: Date;
    role: string;
    organizationId?: string;
    organization?: any;
    userOrganization?: any;
  };
}

export const requireActiveSubscription = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Skip subscription check for super admins
    if (req.user?.isSuperAdmin) {
      next();
      return;
    }

    // Skip subscription check for subscription-related endpoints
    if (req.path.includes("/subscriptions") || req.path.includes("/payments")) {
      next();
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
        code: "AUTHENTICATION_REQUIRED",
      });
      return;
    }

    // Get user's organization
    const userOrg = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, userId))
      .limit(1);

    if (!userOrg.length) {
      res.status(403).json({
        success: false,
        message: "Organization not found",
        code: "ORGANIZATION_NOT_FOUND",
        redirectTo: "/subscriptions",
      });
      return;
    }

    const organizationId = userOrg[0].id;

    // Check for active subscription
    const activeSubscription = await database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organizationId),
          eq(subscriptions.status, "active"),
          gte(subscriptions.currentPeriodEnd, new Date())
        )
      )
      .limit(1);

    if (!activeSubscription.length) {
      res.status(403).json({
        success: false,
        message: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED",
        redirectTo: "/subscriptions",
        subscriptionStatus: "inactive",
      });
      return;
    }

    // Check if subscription is within limits
    const subscription = activeSubscription[0];
    const currentDate = new Date();

    if (subscription.currentPeriodEnd < currentDate) {
      res.status(403).json({
        success: false,
        message: "Subscription expired",
        code: "SUBSCRIPTION_EXPIRED",
        redirectTo: "/subscriptions",
        subscriptionStatus: "expired",
      });
      return;
    }

    // Add subscription info to request for use in other middleware/routes
    req.subscription = subscription;

    next();
  } catch (error) {
    logger.error("Subscription validation error:", error);
    res.status(500).json({
      success: false,
      message: "Subscription validation failed",
      code: "SUBSCRIPTION_VALIDATION_ERROR",
    });
    return;
  }
};

export const checkSubscriptionStatus = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get user's organization
    const userOrg = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, userId))
      .limit(1);

    if (!userOrg.length) {
      req.subscriptionStatus = {
        hasSubscription: false,
        status: "no_organization",
        message: "Organization not found",
      };
      return next();
    }

    const organizationId = userOrg[0].id;

    // Check subscription status
    const subscription = await database
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, organizationId))
      .orderBy(subscriptions.createdAt)
      .limit(1);

    if (!subscription.length) {
      req.subscriptionStatus = {
        hasSubscription: false,
        status: "no_subscription",
        message: "No subscription found",
      };
      return next();
    }

    const sub = subscription[0];
    const currentDate = new Date();

    if (sub.status === "active" && sub.currentPeriodEnd >= currentDate) {
      req.subscriptionStatus = {
        hasSubscription: true,
        status: "active",
        subscription: sub,
        message: "Active subscription",
      };
    } else if (sub.status === "active" && sub.currentPeriodEnd < currentDate) {
      req.subscriptionStatus = {
        hasSubscription: true,
        status: "expired",
        subscription: sub,
        message: "Subscription expired",
      };
    } else {
      req.subscriptionStatus = {
        hasSubscription: true,
        status: sub.status,
        subscription: sub,
        message: `Subscription status: ${sub.status}`,
      };
    }

    next();
  } catch (error) {
    logger.error("Subscription status check error:", error);
    req.subscriptionStatus = {
      hasSubscription: false,
      status: "error",
      message: "Error checking subscription status",
    };
    next();
  }
};
