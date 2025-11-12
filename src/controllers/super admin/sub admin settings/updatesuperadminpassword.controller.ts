import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { account } from "../../../../drizzle/schema";

export const updateSuperAdminPassword = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const { currentPassword, newPassword } = req.body;

    // Validate input
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 8 characters long",
      });
    }

    // Additional password complexity validation for production
    const passwordRegex =
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          "Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character",
      });
    }

    const userId = req.user.id;

    // Get the user's account to check current password
    const userAccount = await database.query.account.findFirst({
      where: eq(account.userId, userId),
    });

    if (!userAccount || !userAccount.password) {
      return res.status(404).json({
        success: false,
        message: "User account not found or no password set",
      });
    }

    // Get Better Auth context for password verification and hashing
    const { auth } = await import("@/lib/auth");
    const context = await auth.$context;

    // Verify current password using Better Auth's verify method
    let isCurrentPasswordValid = false;

    try {
      isCurrentPasswordValid = await context.password.verify({
        password: currentPassword,
        hash: userAccount.password,
      });
    } catch (verifyError) {
      logger.error("Password verification error:", verifyError);
      // In production, we should fail securely rather than bypass verification
      return res.status(500).json({
        success: false,
        message: "Password verification failed. Please try again.",
      });
    }

    // Log the attempt for security monitoring
    // logger.info(`Password update attempt for user: ${userId}`);
    // logger.info(`Current password provided: ${currentPassword ? "Yes" : "No"}`);
    // logger.info(`New password length: ${newPassword?.length || 0}`);
    // logger.info(`Password verification result: ${isCurrentPasswordValid}`);

    if (!isCurrentPasswordValid) {
      // Log failed attempt for security monitoring
      logger.warn(
        `Failed password update attempt for user - incorrect current password`
      );
      return res.status(400).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Hash the new password
    const hashedNewPassword = await context.password.hash(newPassword);

    // Update the password in the database
    await database
      .update(account)
      .set({
        password: hashedNewPassword,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(account.userId, userId));

    // Log successful password update
    logger.info(`Password updated successfully`);

    return res.status(200).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error) {
    logger.error("Error updating password:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while updating password",
    });
  }
};
