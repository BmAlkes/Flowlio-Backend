import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { account, users } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const patchUserProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info(`🔧 PATCH user profile request received`);

    if (!req.user || !req.user.id) {
      logger.error(`❌ No user or user ID found in request`);
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;
    const {
      twoFactorEnabled,
      password,
      notificationPreferences,
      phone,
      address,
      billingEmail,
      name,
      email,
      selectedPlanId,
    } = req.body;

    logger.info(`👤 Patching profile for user: ${userId}`);
    logger.info(`📝 PATCH data received:`, {
      twoFactorEnabled: typeof twoFactorEnabled,
      notificationPreferences: typeof notificationPreferences,
      phone: typeof phone,
      address: typeof address,
      name: typeof name,
      email: typeof email,
    });

    // Check if user exists
    const existingUser = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, twoFactorEnabled: true },
    });

    if (!existingUser) {
      logger.error(`❌ User not found: ${userId}`);
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Build update object with only provided fields
    const updateData: any = {
      updatedAt: new Date(),
    };

    // Require password verification when disabling 2FA
    if (
      typeof twoFactorEnabled === "boolean" &&
      twoFactorEnabled === false &&
      existingUser.twoFactorEnabled
    ) {
      if (typeof password !== "string" || password.trim().length === 0) {
        res.status(400).json({
          success: false,
          message: "Password is required to disable 2FA",
        });
        return;
      }

      const userAccount = await database.query.account.findFirst({
        where: eq(account.userId, userId),
        columns: { password: true },
      });

      if (!userAccount?.password) {
        logger.warn(`❌ Password account not found for user: ${userId}`);
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
        logger.warn(`❌ Invalid password while disabling 2FA for user: ${userId}`);
        res.status(400).json({
          success: false,
          message: "Incorrect password",
        });
        return;
      }
    }

    // Handle different field types
    if (typeof twoFactorEnabled === "boolean") {
      updateData.twoFactorEnabled = twoFactorEnabled;
      logger.info(`🔐 Updating 2FA status for user ${userId} to: ${twoFactorEnabled}`);
    }

    if (typeof phone === "string") {
      updateData.phone = phone === "" ? null : phone;
      logger.info(`📞 Updating phone: ${phone || "null"}`);
    }

    if (typeof address === "string") {
      updateData.address = address === "" ? null : address;
      logger.info(`🏠 Updating address: ${address || "null"}`);
    }

    if (typeof billingEmail === "string") {
      updateData.billingEmail = billingEmail === "" ? null : billingEmail.trim();
    }

    if (typeof name === "string" && name.trim().length > 0) {
      updateData.name = name.trim();
      logger.info(`👤 Updating name: ${name}`);
    }

    if (typeof email === "string" && email.trim().length > 0) {
      // Check if email is already taken by another user
      const emailCheck = await database.query.users.findFirst({
        where: (users, { eq, and, ne }) =>
          and(eq(users.email, email.trim()), ne(users.id, userId)),
      });

      if (emailCheck) {
        logger.warn(`❌ Email already taken by another user: ${email}`);
        res.status(400).json({
          success: false,
          message: "Email is already taken by another user",
        });
        return;
      }

      updateData.email = email.trim();
      logger.info(`📧 Updating email: ${email}`);
    }

    if (
      notificationPreferences &&
      typeof notificationPreferences === "object"
    ) {
      updateData.notificationPreferences = notificationPreferences;
      logger.info(`🔔 Updating notification preferences`);
    }

    if (
      typeof selectedPlanId === "string" &&
      selectedPlanId.trim().length > 0
    ) {
      updateData.selectedPlanId = selectedPlanId.trim();
      logger.info(`📦 Updating selectedPlanId: ${selectedPlanId}`);
    } else if (selectedPlanId === null || selectedPlanId === undefined) {
      // Allow setting to null
      updateData.selectedPlanId = null;
      logger.info(`📦 Clearing selectedPlanId`);
    }

    // Only update if there's something to update (more than just updatedAt)
    if (Object.keys(updateData).length > 1) {
      logger.info(`📝 Database update for user ${userId}:`, updateData);

      const updatedUser = await database
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId))
        .returning();

      if (updatedUser.length === 0) {
        logger.error(`❌ No user returned after update: ${userId}`);
        res.status(404).json({
          success: false,
          message: "User not found or no changes made",
        });
        return;
      }

      logger.info(`✅ Profile patched successfully for user: ${userId}. New 2FA status: ${updatedUser[0].twoFactorEnabled}`);
      logger.info(
        `📝 Updated fields:`,
        Object.keys(updateData).filter((key) => key !== "updatedAt")
      );

      res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: updatedUser[0],
      });
    } else {
      logger.warn(`⚠️ No valid fields to update for user: ${userId}`);
      res.status(400).json({
        success: false,
        message: "No valid fields to update",
      });
    }
  } catch (error) {
    logger.error("❌ Error patching user profile:", error);
    logger.error("❌ Error details:", {
      message: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      userId: req.user?.id,
      requestBody: req.body,
    });

    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while updating profile",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
