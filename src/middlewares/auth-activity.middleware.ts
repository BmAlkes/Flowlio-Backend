import { Request, Response, NextFunction } from "express";
import { database } from "@/configs/connection.config";
import * as schema from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";
import { logger } from "@/utils/logger.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";

/**
 * Middleware to log authentication activities (login/logout)
 * This middleware wraps the better-auth handler to intercept successful auth operations
 */
export const authActivityMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const isSignInPath = req.path.includes("/sign-in");
  const isSignOutPath = req.path.includes("/sign-out");
  const isSignUpPath = req.path.includes("/sign-up");

  // Store the original methods
  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);
  const originalEnd = res.end.bind(res);

  // Track if we've already logged to avoid double logging
  let logged = false;

  const logIfNeeded = (body: any) => {
    if (logged) return;

    const statusOk = res.statusCode >= 200 && res.statusCode < 300;
    const isSignIn = isSignInPath && statusOk;
    const isSignOut = isSignOutPath && statusOk;
    const isSignUp = isSignUpPath && statusOk;

    if (isSignIn || isSignOut) {
      logged = true;
      // Log activities asynchronously without blocking the response
      logAuthActivity(req, body, isSignIn ? "login" : "logout").catch(
        (error) => {
          logger.error("Failed to log auth activity:", error);
        }
      );
    }

    if (isSignUp) {
      logged = true;
      // Notify super admins about new user signup (non-blocking)
      handleNewUserSignup(body).catch((error) => {
        logger.error("Failed to handle new user signup notification:", error);
      });
    }
  };

  // Override res.json to intercept the response
  res.json = function (body: any) {
    logIfNeeded(body);
    return originalJson(body);
  };

  // Override res.send for compatibility
  res.send = function (body: any) {
    logIfNeeded(body);
    return originalSend(body);
  };

  // Override res.end as better-auth might use it
  res.end = function (chunk?: any, encoding?: any) {
    if (chunk && typeof chunk === "string") {
      try {
        const parsed = JSON.parse(chunk);
        logIfNeeded(parsed);
      } catch {
        // Not JSON, ignore
      }
    }
    return originalEnd(chunk, encoding);
  };

  // Listen for 'finish' event as fallback
  res.on("finish", () => {
    if (!logged && (isSignInPath || isSignOutPath)) {
      const statusOk = res.statusCode >= 200 && res.statusCode < 300;
      if (statusOk) {
        // Try to get response data from headers or use empty object
        logAuthActivity(req, {}, isSignInPath ? "login" : "logout").catch(
          (error) => {
            logger.error("Failed to log auth activity:", error);
          }
        );
      }
    }
  });

  next();
};

/**
 * Log authentication activity
 */

async function logAuthActivity(
  req: Request,
  responseBody: any,
  action: "login" | "logout"
): Promise<void> {
  try {
    let userId: string | undefined;

    // Try to get user ID from response body
    if (action === "login" && responseBody?.user?.id) {
      userId = responseBody.user.id;
    } else if (action === "login" && responseBody?.session?.user?.id) {
      userId = responseBody.session.user.id;
    } else if (action === "logout") {
      // For logout, try to get from session before it's destroyed
      const sessionToken = req.cookies?.session_token;
      if (sessionToken) {
        // Try to get user from session
        try {
          const { auth } = await import("@/lib/auth");
          const session = await auth.api.getSession({
            headers: req.headers as any,
          });
          if (session?.user) {
            userId = session.user.id;
          }
        } catch (sessionError) {
          logger.warn(
            "Could not get user from session for logout:",
            sessionError
          );
        }
      }
    }

    if (!userId) {
      logger.warn(`Could not determine userId for ${action} activity`);
      return;
    }

    // Get user's organization
    const userOrg = await database
      .select({
        organizationId: schema.userOrganizations.organizationId,
      })
      .from(schema.userOrganizations)
      .where(eq(schema.userOrganizations.userId, userId))
      .limit(1);

    const organizationId = userOrg[0]?.organizationId;
    if (!organizationId) {
      logger.warn(`No organization found for user ${userId} during ${action}`);
      return;
    }

    // Get user's name for the message
    const userDetails = await database
      .select({ name: schema.users.name, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    await logActivity({
      organizationId,
      actorId: userId,
      userId,
      type: "auth",
      action,
      resource: "user",
      resourceId: userId,
      message: userDetails[0]?.name
        ? `${userDetails[0].name} logged ${action === "login" ? "in" : "out"}`
        : `User logged ${action === "login" ? "in" : "out"}`,
      metadata: {
        email: userDetails[0]?.email,
        timestamp: new Date().toISOString(),
      },
    });

    logger.info(
      `✅ Logged ${action} activity for user ${userId} in organization ${organizationId}`
    );
  } catch (error) {
    logger.error(`Failed to log ${action} activity:`, error);
  }
}

/**
 * Handle new user signup notification
 */
async function handleNewUserSignup(responseBody: any): Promise<void> {
  try {
    let userId: string | undefined;
    let userEmail: string | undefined;
    let userName: string | undefined;

    // Try to get user info from response body
    if (responseBody?.user?.id) {
      userId = responseBody.user.id;
      userEmail = responseBody.user.email;
      userName = responseBody.user.name;
    } else if (responseBody?.session?.user?.id) {
      userId = responseBody.session.user.id;
      userEmail = responseBody.session.user.email;
      userName = responseBody.session.user.name;
    }

    // If we don't have user info from response, try to get it from the database
    if (!userId && userEmail) {
      const user = await database
        .select({
          id: schema.users.id,
          email: schema.users.email,
          name: schema.users.name,
        })
        .from(schema.users)
        .where(eq(schema.users.email, userEmail))
        .limit(1);

      if (user.length > 0) {
        userId = user[0].id;
        userName = user[0].name;
      }
    }

    if (!userId) {
      logger.warn(
        "Could not determine userId for new user signup notification"
      );
      return;
    }

    // Don't notify if the new user is a super admin
    const userDetails = await database
      .select({ isSuperAdmin: schema.users.isSuperAdmin })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (userDetails[0]?.isSuperAdmin) {
      logger.info(`Skipping notification for super admin signup: ${userId}`);
      return;
    }

    // Notify super admins about new user signup
    await notifySuperAdmins({
      type: "newUserSignup",
      title: "New User Registration",
      message: `A new user has registered on Flowlio.`,
      details: {
        User: userName || userEmail || "Unknown",
        "User Email": userEmail || "Unknown",
        "Registration Date": new Date().toLocaleString(),
      },
    });

    logger.info(`✅ Sent new user signup notification for user ${userId}`);
  } catch (error) {
    logger.error("Failed to handle new user signup notification:", error);
  }
}
