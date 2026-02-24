import { Request, Response, NextFunction } from "express";
import { getSession } from "@/utils/getsession.util";
import { logger } from "@/utils/logger.util";
// import { status } from "http-status";
import { database } from "@/configs/connection.config";
import { subscriptions, users } from "@/schema/schema";
import { eq, and } from "drizzle-orm";

// In-memory cache for organization data (TTL: 10 seconds)
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const orgCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL = 10 * 1000; // 10 seconds

const getCachedOrFetch = async <T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> => {
  const cached = orgCache.get(key);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const data = await fetcher();
  orgCache.set(key, { data, timestamp: now });
  return data;
};

// Clean up old cache entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of orgCache.entries()) {
    if (now - entry.timestamp >= CACHE_TTL) {
      orgCache.delete(key);
    }
  }
}, CACHE_TTL);

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        name: string;
        email: string;
        emailVerified: boolean;
        image?: string;
        isSuperAdmin: boolean;
        isOrganizationOwner?: boolean;
        isOrganizationManager?: boolean;
        subadminId?: string;
        createdAt: Date;
        updatedAt: Date;
        role: string;
        organizationId?: string;
        organization?: any;
        userOrganization?: any;
      };
      session?: any;
    }
  }
}

export const isAuthenticated = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Reduced logging for performance - only log in development
    const isDevelopment = process.env.NODE_ENV !== "production";
    if (isDevelopment) {
      logger.debug("🚀 isAuthenticated middleware called");
    }

    const session = await getSession(req);

    if (session && session.user) {
      const sessionUser = session.user as any;

      // Session may not have isOrganizationOwner/Manager if created before we added it
      // Fetch from DB when missing so org owner/manager access works without re-login
      let isOrganizationOwner = sessionUser.isOrganizationOwner;
      let isOrganizationManager = sessionUser.isOrganizationManager;

      if (
        isOrganizationOwner === undefined ||
        isOrganizationManager === undefined
      ) {
        const dbUser = await database
          .select({
            isOrganizationOwner: users.isOrganizationOwner,
            isOrganizationManager: users.isOrganizationManager,
          })
          .from(users)
          .where(eq(users.id, sessionUser.id))
          .limit(1);

        if (dbUser.length > 0) {
          isOrganizationOwner = dbUser[0].isOrganizationOwner ?? false;
          isOrganizationManager = dbUser[0].isOrganizationManager ?? false;
        } else {
          isOrganizationOwner = false;
          isOrganizationManager = false;
        }
      }

      // Use session data directly to avoid unnecessary DB query
      // Only fetch from DB if we need fresh data for security checks
      const freshUser = {
        id: sessionUser.id,
        name: sessionUser.name,
        email: sessionUser.email,
        emailVerified: sessionUser.emailVerified,
        image: sessionUser.image,
        isSuperAdmin: sessionUser.isSuperAdmin,
        isOrganizationOwner: isOrganizationOwner ?? false,
        isOrganizationManager: isOrganizationManager ?? false,
        subadminId: sessionUser.subadminId,
        createdAt: sessionUser.createdAt,
        updatedAt: sessionUser.updatedAt,
        role: sessionUser.role,
      };

      if (freshUser) {
        // Check sub admin permission status if user is a sub admin
        if (freshUser.role === "subadmin" && freshUser.subadminId) {
          const subAdminData = await database.query.subadmin.findFirst({
            where: (table, { eq }) => eq(table.id, freshUser.subadminId!),
            columns: {
              id: true,
              permission: true,
            },
          });

          if (!subAdminData) {
            logger.warn("Sub admin data not found for user:", freshUser.id);
            res.status(403).json({
              error: "Forbidden",
              message: "Sub admin account not found",
            });
            return;
          }

          if (subAdminData.permission !== "Active") {
            logger.warn("Sub admin access denied - inactive permission:", {
              userId: freshUser.id,
              subadminId: freshUser.subadminId,
              permission: subAdminData.permission,
            });
            res.status(403).json({
              error: "Forbidden",
              message:
                "Your account access has been deactivated. Please contact the administrator.",
              code: "SUBADMIN_DEACTIVATED",
            });
            return;
          }

          logger.info("Sub admin permission check passed:", {
            userId: freshUser.id,
            subadminId: freshUser.subadminId,
            permission: subAdminData.permission,
          });
        }

        // Fetch user's organization information (with caching)
        const isDevelopment = process.env.NODE_ENV !== "production";
        if (isDevelopment) {
          logger.debug("🔍 Fetching organization for user:", freshUser.id);
        }

        try {
          // Get all user organizations and find the active one (cached)
          const userOrgs = await getCachedOrFetch(
            `userOrgs:${freshUser.id}`,
            async () => {
              return await database.query.userOrganizations.findMany({
                where: (userOrgs, { eq }) => eq(userOrgs.userId, freshUser.id),
                with: {
                  organization: true,
                },
              });
            },
          );

          if (isDevelopment) {
            logger.debug("🔍 User organizations found:", userOrgs.length);
          }

          // Find the active organization (prioritize 'active' status)
          let activeUserOrg = userOrgs.find((org) => org.status === "active");

          // If no active organization found, use the first one
          if (!activeUserOrg && userOrgs.length > 0) {
            activeUserOrg = userOrgs[0];
            logger.warn(
              "⚠️ No active organization found, using first available:",
              activeUserOrg.organizationId,
            );
          }

          // Reduced logging - only in development
          if (isDevelopment && activeUserOrg) {
            logger.debug("🔍 Selected organization:", {
              organizationId: activeUserOrg.organizationId,
              status: activeUserOrg.status,
            });
          }

          // Check if organization is deactivated or trial expired (unless super admin)
          if (!freshUser.isSuperAdmin && activeUserOrg?.organization) {
            const org = activeUserOrg.organization;
            const orgStatus = org.status;

            // Check 1: Organization is deactivated
            if (orgStatus === "suspended" || orgStatus === "inactive") {
              logger.warn(
                `User ${freshUser.id} attempted to access route with deactivated organization ${activeUserOrg.organizationId}`,
              );
              res.status(403).json({
                error: "Forbidden",
                message:
                  "Your organization account has been deactivated. Please contact the administrator for assistance.",
                code: "ORGANIZATION_DEACTIVATED",
              });
              return;
            }

            // Check 2: Trial period has expired
            const trialEndsAt = org.trialEndsAt;
            const subscriptionStatus = org.subscriptionStatus;
            const now = new Date();

            if (trialEndsAt) {
              const trialEndDate = new Date(trialEndsAt);

              // If trial has expired AND subscription is not active/valid
              if (
                trialEndDate < now &&
                subscriptionStatus !== "active" &&
                subscriptionStatus !== "trialing"
              ) {
                logger.warn(
                  `User ${
                    freshUser.id
                  } attempted to access route with expired trial organization ${
                    activeUserOrg.organizationId
                  }. Trial ended: ${trialEndDate.toISOString()}`,
                );
                res.status(403).json({
                  error: "Forbidden",
                  message:
                    "Your trial period has expired. Please contact the administrator to upgrade your subscription.",
                  code: "TRIAL_EXPIRED",
                });
                return;
              }
            }

            // Check 3: Subscription period has expired (based on plan duration)
            // Get the active subscription for this organization (cached)
            const activeSubscription = await getCachedOrFetch(
              `subscription:${activeUserOrg.organizationId}`,
              async () => {
                return await database
                  .select()
                  .from(subscriptions)
                  .where(
                    and(
                      eq(
                        subscriptions.organizationId,
                        activeUserOrg.organizationId,
                      ),
                      eq(subscriptions.status, "active"),
                    ),
                  )
                  .orderBy(subscriptions.createdAt)
                  .limit(1);
              },
            );

            if (activeSubscription.length > 0) {
              const subscription = activeSubscription[0];
              const currentPeriodEnd = subscription.currentPeriodEnd;

              // Check if subscription period has expired
              if (currentPeriodEnd && new Date(currentPeriodEnd) < now) {
                logger.warn(
                  `User ${
                    freshUser.id
                  } attempted to access route with expired subscription for organization ${
                    activeUserOrg.organizationId
                  }. Subscription ended: ${new Date(
                    currentPeriodEnd,
                  ).toISOString()}`,
                );
                res.status(403).json({
                  error: "Forbidden",
                  message:
                    "Your subscription has expired. Please renew your subscription to continue using the service.",
                  code: "SUBSCRIPTION_EXPIRED",
                  redirectTo: "/pricing",
                });
                return;
              }

              // Check if subscription is scheduled to cancel at period end
              if (
                subscription.cancelAtPeriodEnd &&
                currentPeriodEnd &&
                new Date(currentPeriodEnd) >= now
              ) {
                logger.info(
                  `User ${
                    freshUser.id
                  } has subscription scheduled to cancel at period end for organization ${
                    activeUserOrg.organizationId
                  }. Period ends: ${new Date(currentPeriodEnd).toISOString()}`,
                );
                // Allow access but subscription will expire at period end
              }
            } else if (
              subscriptionStatus === "active" ||
              subscriptionStatus === "trialing"
            ) {
              // If organization shows active but no subscription found, allow access
              // This might be a trial-only organization
              logger.info(
                `User ${freshUser.id} has active organization status but no subscription record for organization ${activeUserOrg.organizationId}`,
              );
            }
          }

          // Add organization info to user object
          // Only set organizationId if organization actually exists in database
          if (activeUserOrg?.organizationId && !activeUserOrg?.organization) {
            logger.warn(
              `⚠️ User ${freshUser.id} has organizationId ${activeUserOrg.organizationId} in userOrganizations but organization doesn't exist in organizations table. This is a data integrity issue.`,
            );
          }

          const userWithOrg = {
            ...freshUser,
            organizationId:
              activeUserOrg?.organization && activeUserOrg?.organizationId
                ? activeUserOrg.organizationId
                : null,
            organization: activeUserOrg?.organization || null,
            userOrganization: activeUserOrg || null,
          };

          // Set the user data
          req.user = userWithOrg as any;

          // Only log in development
          if (isDevelopment) {
            logger.debug("✅ User authenticated:", {
              userId: userWithOrg.id,
              organizationId: userWithOrg.organizationId,
            });
          }

          return next();
        } catch (orgError) {
          logger.error("❌ Error fetching organization:", orgError);
          // Continue without organization data
          req.user = freshUser as any;
          return next();
        }
      }
    }

    logger.error("❌ Unauthorized: No valid session found");
    res.status(401).json({
      error: "Unauthorized",
      message: "No valid session found",
    });
  } catch (error) {
    logger.error("❌ Authentication error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Authentication failed",
    });
  }
};

export const isUnAuthenticated = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const session = await getSession(req);

    if (!session) {
      return next();
    }

    logger.error("User is already authenticated");
    res.status(400).json({
      error: "Bad Request",
      message: "User is already authenticated",
    });
  } catch (error) {
    logger.error("❌ Unauthenticated check error:", error);
    res.status(500).json({
      error: "Internal server error",
      message: "Authentication check failed",
    });
  }
};
