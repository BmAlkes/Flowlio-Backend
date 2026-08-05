import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { files, fileVersions, clients } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { uploadToCloudinary } from "@/utils/cloudinary.util";

/**
 * POST /api/clients/:clientId/media
 * Uploads a file directly into a client's Media Center, without requiring
 * an associated task. Persists into 'files' + 'file_versions' so it shows
 * up in GET /api/clients/:clientId/media alongside task/project attachments.
 */
export const uploadClientMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { clientId } = req.params;
    const { projectId } = req.body;
    const organizationId = user.organizationId;

    const client = await database.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)),
    });

    if (!client) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Client not found",
      });
      return;
    }

    const multerFile = (req as any).file;
    if (!multerFile) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "No file provided",
      });
      return;
    }

    if (!multerFile.filepath) {
      multerFile.filepath = multerFile.path;
    }

    const uploadResult = await uploadToCloudinary(multerFile, "media");

    const newFile = await database.insert(files).values({
      name: multerFile.originalname,
      organizationId,
      projectId: projectId || null,
      taskId: null,
      clientId,
      uploadedBy: user.id,
    }).returning();

    const fileRecord = newFile[0];

    const version = await database.insert(fileVersions).values({
      fileId: fileRecord.id,
      url: uploadResult.secure_url,
      name: multerFile.originalname,
      size: multerFile.size,
      type: multerFile.mimetype,
      versionNumber: 1,
      uploadedBy: user.id,
    }).returning();

    const mediaItem = {
      fileId: fileRecord.id,
      fileName: fileRecord.name,
      fileType: version[0].type,
      fileUrl: version[0].url,
      projectId: fileRecord.projectId,
      taskId: fileRecord.taskId,
      clientId: fileRecord.clientId,
      uploadedBy: fileRecord.uploadedBy,
      createdAt: fileRecord.createdAt,
      latestVersion: 1,
    };

    res.status(status.CREATED).json({
      success: true,
      message: "Media uploaded successfully",
      data: mediaItem,
    });
  } catch (error) {
    logger.error("Error in uploadClientMedia controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to upload media file",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
