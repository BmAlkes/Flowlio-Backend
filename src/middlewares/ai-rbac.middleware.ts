import { Request, Response, NextFunction } from "express";

export const checkAIAccess = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const role = req.user?.role;

  if (role === "client" || role === "viewer") {
    res
      .status(403)
      .json({ error: "You do not have permission to use AI features" });
    return;
  }

  next();
};
