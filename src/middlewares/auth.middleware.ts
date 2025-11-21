import { Request, Response, NextFunction } from "express";
import { getSession } from "@/utils/getsession.util";
import { logger } from "@/utils/logger.util";
// import { status } from "http-status";
import { database } from "@/configs/connection.config";

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
  next: NextFunction
) => {
  try {
    logger.info("🚀 isAuthenticated middleware called", {
      path: req.path,
      method: req.method,
      originalUrl: req.originalUrl,
    });

    const session = await getSession(req);
    logger.info("🔍 Session data:", {
      hasSession: !!session,
      hasUser: !!session?.user,
      userId: session?.user?.id,
    });

    if (session && session.user) {
      const sessionUser = session.user as any;
      logger.info("🔍 Original session user data:", {
        id: sessionUser.id,
        email: sessionUser.email,
        isSuperAdmin: sessionUser.isSuperAdmin,
        subadminId: sessionUser.subadminId,
        role: sessionUser.role,
      });

      const freshUser = await database.query.users.findFirst({
        where: (t, { eq }) => eq(t.id, sessionUser.id),
        columns: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          isSuperAdmin: true,
          subadminId: true,
          createdAt: true,
          updatedAt: true,
          role: true,
          status: true, // Include user status (pending/active)
          selectedPlanId: true, // Include selected plan ID
          pendingOrganizationData: true, // Include pending organization data
        },
      });

      if (freshUser) {
        // Check if user is pending (hasn't completed payment)
        // Allow access to payment/checkout routes and profile endpoint
        const path = req.path || req.originalUrl || "";
        const isPaymentRoute =
          path.includes("/payment") ||
          path.includes("/checkout") ||
          path.includes("/order") ||
          path.includes("/paypal") ||
          path.includes("/user/profile");

        // Debug logging
        const hasPendingPaymentDataDebug =
          !!freshUser.selectedPlanId || !!freshUser.pendingOrganizationData;
        logger.info("🔍 User Status Check:", {
          userId: freshUser.id,
          userStatus: freshUser.status,
          isSuperAdmin: freshUser.isSuperAdmin,
          path: path,
          originalUrl: req.originalUrl,
          isPaymentRoute,
          selectedPlanId: freshUser.selectedPlanId,
          hasPendingOrgData: !!freshUser.pendingOrganizationData,
          hasPendingPaymentData: hasPendingPaymentDataDebug,
          willBeBlocked:
            (freshUser.status === "pending" ||
              ((freshUser.status === null ||
                freshUser.status === undefined ||
                freshUser.status !== "active") &&
                hasPendingPaymentDataDebug)) &&
            !freshUser.isSuperAdmin &&
            !isPaymentRoute,
        });

        // Check if user is pending (hasn't completed payment)
        //
        // A user is considered pending if:
        // 1. Status is explicitly "pending" (regardless of payment data)
        // 2. Status is NOT "active" AND has payment data (selectedPlanId or pendingOrganizationData)
        //
        // After successful payment:
        // - Status is set to "active"
        // - selectedPlanId is cleared (set to null)
        // - pendingOrganizationData is cleared (set to null)
        //
        // So if status is "active", user is NOT pending (even if payment data somehow exists)
        const hasPendingPaymentData =
          !!freshUser.selectedPlanId || !!freshUser.pendingOrganizationData;

        // User is pending if:
        // - Status is "pending" (explicitly pending)
        // - Status is NOT "active" AND has payment data (has plan selected but payment not completed)
        const isPending =
          freshUser.status === "pending" ||
          (freshUser.status !== "active" && hasPendingPaymentData);

        // Final check: user is pending if conditions above are met AND not superadmin
        // Superadmins are always allowed to access all routes
        const isUserPending = isPending && !freshUser.isSuperAdmin;

        if (isUserPending && !isPaymentRoute) {
          logger.warn(
            `🚫 BLOCKING: User ${freshUser.id} with pending status attempted to access protected route: ${path}`
          );
          res.status(403).json({
            success: false,
            error: "Forbidden",
            message:
              "Your account is pending payment. Please complete your payment to access your account.",
            code: "USER_PENDING",
            data: {
              selectedPlanId: freshUser.selectedPlanId,
              pendingOrganizationData: freshUser.pendingOrganizationData,
            },
          });
          return;
        }

        logger.info("✅ User access allowed:", {
          userId: freshUser.id,
          status: freshUser.status,
          path: path,
          isPending: false,
        });

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

        // Fetch user's organization information
        logger.info("🔍 Fetching organization for user:", freshUser.id);

        try {
          // Get all user organizations and find the active one
          const userOrgs = await database.query.userOrganizations.findMany({
            where: (userOrgs, { eq }) => eq(userOrgs.userId, freshUser.id),
            with: {
              organization: true,
            },
          });

          logger.info("🔍 User organizations found:", userOrgs.length);

          // Find the active organization (prioritize 'active' status)
          let activeUserOrg = userOrgs.find((org) => org.status === "active");

          // If no active organization found, use the first one
          if (!activeUserOrg && userOrgs.length > 0) {
            activeUserOrg = userOrgs[0];
            logger.warn(
              "⚠️ No active organization found, using first available:",
              activeUserOrg.organizationId
            );
          }

          logger.info("🔍 Selected organization:", {
            userOrgFound: !!activeUserOrg,
            userOrgData: activeUserOrg
              ? {
                  id: activeUserOrg.id,
                  userId: activeUserOrg.userId,
                  organizationId: activeUserOrg.organizationId,
                  status: activeUserOrg.status,
                  organization: activeUserOrg.organization
                    ? {
                        id: activeUserOrg.organization.id,
                        name: activeUserOrg.organization.name,
                        slug: activeUserOrg.organization.slug,
                      }
                    : null,
                }
              : null,
          });

          // Check if organization is deactivated or trial expired (unless super admin)
          if (!freshUser.isSuperAdmin && activeUserOrg?.organization) {
            const org = activeUserOrg.organization;
            const orgStatus = org.status;
            const orgSettings = org.settings as { demo?: boolean } | null;
            const isDemoAccount = orgSettings?.demo === true;

            // Check 1: Organization is deactivated (including demo accounts)
            if (orgStatus === "suspended" || orgStatus === "inactive") {
              const errorMessage = isDemoAccount
                ? "This demo account has been deactivated. Please contact the administrator for assistance."
                : "Your organization account has been deactivated. Please contact the administrator for assistance.";

              logger.warn(
                `User ${freshUser.id} attempted to access route with deactivated organization ${activeUserOrg.organizationId} - ${errorMessage}`
              );
              res.status(403).json({
                error: "Forbidden",
                message: errorMessage,
                code: "ORGANIZATION_DEACTIVATED",
              });
              return;
            }

            // Check 2: Trial period has expired (especially for demo accounts)
            const trialEndsAt = org.trialEndsAt;
            const subscriptionStatus = org.subscriptionStatus;
            const now = new Date();

            if (trialEndsAt) {
              const trialEndDate = new Date(trialEndsAt);

              // For demo accounts: ALWAYS block if trial has expired (regardless of subscription status)
              // Demo accounts are trial-only and should not be allowed after trial ends
              if (isDemoAccount && trialEndDate < now) {
                logger.warn(
                  `User ${
                    freshUser.id
                  } attempted to access route with expired demo account ${
                    activeUserOrg.organizationId
                  }. Trial ended: ${trialEndDate.toISOString()}`
                );
                res.status(403).json({
                  error: "Forbidden",
                  message:
                    "This demo account's trial period has expired. Please contact the administrator for assistance.",
                  code: "TRIAL_EXPIRED",
                });
                return;
              }

              // For regular accounts: Block if trial has expired AND subscription is not active/valid
              if (
                !isDemoAccount &&
                trialEndDate < now &&
                subscriptionStatus !== "active" &&
                subscriptionStatus !== "trialing"
              ) {
                logger.warn(
                  `User ${
                    freshUser.id
                  } attempted to access route with expired trial organization ${
                    activeUserOrg.organizationId
                  }. Trial ended: ${trialEndDate.toISOString()}`
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
          }

          // Add organization info to user object
          const userWithOrg = {
            ...freshUser,
            organizationId: activeUserOrg?.organizationId || null,
            organization: activeUserOrg?.organization || null,
            userOrganization: activeUserOrg || null,
          };

          logger.info("🔄 Fresh user data with organization:", {
            id: userWithOrg.id,
            email: userWithOrg.email,
            isSuperAdmin: userWithOrg.isSuperAdmin,
            subadminId: userWithOrg.subadminId,
            role: userWithOrg.role,
            organizationId: userWithOrg.organizationId,
            organizationName: userWithOrg.organization?.name,
            finalUserObject: JSON.stringify(userWithOrg, null, 2),
          });

          // Set the user data
          req.user = userWithOrg as any;

          logger.info("✅ Final req.user set:", {
            reqUserKeys: req.user ? Object.keys(req.user) : [],
            reqUserOrganizationId: req.user?.organizationId,
            reqUserType: typeof req.user,
          });

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
  next: NextFunction
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
