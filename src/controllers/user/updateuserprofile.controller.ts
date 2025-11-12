import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { users } from "@/schema/schema";
import { z } from "zod";
import status from "http-status";
import { logActivity } from "@/utils/activity.util";

const updateUserProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().optional(),
  address: z.string().optional(),
});

export const updateUserProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      logger.error(`❌ No user or user ID found in request`);
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;
    const organizationId = (req.user as any)?.organizationId as
      | string
      | undefined;

    // Validate request body
    let validatedData;
    try {
      validatedData = updateUserProfileSchema.parse(req.body);
    } catch (validationError) {
      logger.error(`❌ Validation failed:`, validationError);
      throw validationError;
    }

    // Check if user exists
    const existingUser = await database.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true },
    });

    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Check if email is already taken by another user
    const emailCheck = await database.query.users.findFirst({
      where: (users, { eq, and, ne }) =>
        and(eq(users.email, validatedData.email), ne(users.id, userId)),
    });

    if (emailCheck) {
      res.status(400).json({
        success: false,
        message: "Email is already taken by another user",
      });
      return;
    }

    // Prepare update data
    const updateData: any = {
      name: validatedData.name,
      email: validatedData.email,
      updatedAt: new Date(),
    };

    // Handle phone and address fields
    if (validatedData.phone !== undefined) {
      updateData.phone =
        validatedData.phone === "" ? null : validatedData.phone;
    }

    if (validatedData.address !== undefined) {
      updateData.address =
        validatedData.address === "" ? null : validatedData.address;
    }

    const updatedUser = await database
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning();

    if (!updatedUser[0]) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Log activity (if organizationId present)
    if (organizationId) {
      await logActivity({
        organizationId,
        actorId: userId,
        userId,
        type: "user",
        action: "update",
        resource: "user",
        resourceId: userId,
        message: `Updated profile details`,
        metadata: { fields: Object.keys(updateData) },
      });
    }

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: updatedUser[0],
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.log("🚨 Zod validation error:", error.errors);
      logger.warn("Validation error in update user profile:", error.errors);
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
      return;
    }

    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while updating profile",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
