import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { account } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const verifyCurrentUserPassword = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user?.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { password } = req.body as { password?: string };
    if (typeof password !== "string" || password.trim().length === 0) {
      res.status(400).json({
        success: false,
        message: "Password is required",
      });
      return;
    }

    const userAccount = await database.query.account.findFirst({
      where: eq(account.userId, req.user.id),
      columns: { password: true },
    });

    if (!userAccount?.password) {
      res.status(400).json({
        success: false,
        message: "Unable to verify password for this account",
      });
      return;
    }

    const { auth } = await import("@/lib/auth");
    const context = await auth.$context;
    const isPasswordValid = await context.password.verify({
      password,
      hash: userAccount.password,
    });

    if (!isPasswordValid) {
      res.status(400).json({
        success: false,
        message: "Incorrect password",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Password verified successfully",
    });
  } catch (error) {
    logger.error("❌ Error verifying current user password:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while verifying password",
    });
  }
};
