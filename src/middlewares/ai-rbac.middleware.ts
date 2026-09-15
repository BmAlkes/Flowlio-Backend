import { Request, Response, NextFunction } from "express";

export const checkAIAccess = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const role = req.user?.role;

  if (!req.user?.id) { res.status(401).json({ error: "AUTHENTICATION_REQUIRED" }); return; }
  if (!role || !["user", "operator", "subadmin", "superadmin"].includes(role)) {
    res
      .status(403)
      .json({ error: "You do not have permission to use AI features" });
    return;
  }

  next();
};

export const requireAIOrganization = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user?.organizationId) {
    res.status(403).json({ success: false, error: "ORGANIZATION_REQUIRED", message: "Organization is required for AI generation." });
    return;
  }
  next();
};
