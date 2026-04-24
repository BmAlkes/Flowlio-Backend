import { Request, Response } from "express";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import status from "http-status";
import { logger } from "@/utils/logger.util";

/**
 * POST /api/editor/upload
 * Handles inline image uploads from rich text editors.
 * Returns the secure Cloudinary URL of the uploaded image.
 */
export const uploadEditorImage = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({ 
        success: false, 
        message: "User not authenticated" 
      });
      return;
    }

    const multerFile = (req as any).file;
    const base64File = req.body.image || req.body.file; // Accept 'image' or 'file' field
    const fileToUpload = multerFile || base64File;

    if (!fileToUpload) {
      res.status(status.BAD_REQUEST).json({ 
        success: false, 
        message: "No image file provided" 
      });
      return;
    }

    // Adapt multer file for uploadToCloudinary which expects 'filepath' property
    if (multerFile && !multerFile.filepath) {
      multerFile.filepath = multerFile.path;
    }

    // Upload to Cloudinary in the 'newsletter_editor' folder
    const uploadResult = await uploadToCloudinary(fileToUpload, "newsletter_editor");

    res.status(status.OK).json({
      success: true,
      message: "Image uploaded successfully",
      url: uploadResult.secure_url,
      publicId: uploadResult.public_id
    });

  } catch (error: any) {
    logger.error("Error in uploadEditorImage controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: "Failed to upload editor image",
      error: error.message || "Unknown error"
    });
  }
};
