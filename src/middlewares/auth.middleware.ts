import { Request, Response, NextFunction } from "express";
import { getSession } from "@/utils/getsession.util";
import { logger } from "@/utils/logger.util";
import {
  resolveSessionUser,
  SessionAccessError,
} from "@/security/session-access";

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
    const session = await getSession(req);
    if (!session?.user) {
      res
        .status(401)
        .json({
          error: "Unauthorized",
          code: "SESSION_INVALID",
          message: "No valid session found",
        });
      return;
    }
    req.user = (await resolveSessionUser(
      session.user.id,
    )) as Express.Request["user"];
    req.session = session;
    next();
  } catch (error) {
    if (error instanceof SessionAccessError) {
      res
        .status(error.status)
        .json({ error: "Forbidden", code: error.code, message: error.message });
      return;
    }
    logger.error("Authentication failed", error);
    res
      .status(500)
      .json({
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
