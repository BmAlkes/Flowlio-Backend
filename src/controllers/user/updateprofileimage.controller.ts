import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { users } from "../../../drizzle/schema";
import {
  uploadToCloudinary,
  deleteSingleResouceFromCloudinary,
} from "@/utils/cloudinary.util";
import formidable from "formidable";
import status from "http-status";

export const updateProfileImage = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;

    // Parse form data to get the uploaded file
    const form = formidable();
    const [_fields, files] = await form.parse(req);
    const file = files.image?.[0];

    if (!file) {
      res.status(400).json({
        success: false,
        message: "No image file provided",
      });
      return;
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.mimetype || "")) {
      res.status(400).json({
        success: false,
        message:
          "Invalid file type. Only JPEG, PNG, and WebP images are allowed.",
      });
      return;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size && file.size > maxSize) {
      res.status(400).json({
        success: false,
        message: "File size too large. Maximum size is 5MB.",
      });
      return;
    }

    // Get current user to check if they have an existing image
    const currentUser = await database.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!currentUser) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Upload new image to Cloudinary
    const uploadResult = await uploadToCloudinary(
      file,
      "flowlio/profile-images",
      `user-${userId}`
    );

    // Delete old image from Cloudinary if it exists
    if (currentUser.image && currentUser.image !== uploadResult.secure_url) {
      try {
        // Extract public ID from the old image URL
        const oldImageUrl = currentUser.image;
        const publicIdMatch = oldImageUrl.match(/\/v\d+\/([^/]+)\./);
        if (publicIdMatch) {
          const oldPublicId = publicIdMatch[1];
          await deleteSingleResouceFromCloudinary(oldPublicId, "image");
        }
      } catch (deleteError) {
        logger.warn(`Failed to delete old profile image: ${deleteError}`);
        // Continue with update even if old image deletion fails
      }
    }

    // Update user profile with new image URL
    const updatedUser = await database
      .update(users)
      .set({
        image: uploadResult.secure_url,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning();

    // logger.info(`Profile image updated successfully for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: "Profile image updated successfully",
      data: {
        image: uploadResult.secure_url,
        user: updatedUser[0],
      },
    });
  } catch (error) {
    logger.error("Error updating profile image:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error while updating profile image",
    });
  }
};
