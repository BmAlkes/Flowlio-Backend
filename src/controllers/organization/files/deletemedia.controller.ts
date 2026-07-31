import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { files, fileVersions, tasks, projects } from "@/schema/schema";
import { eq, sql, and } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";
import { deleteSingleResouceFromCloudinary } from "@/utils/cloudinary.util";

/**
 * DELETE /api/media/:fileId
 * Deletes a media file by its ID. Supports both the new structured files table
 * and legacy JSONB attachments in tasks/projects.
 */
export const deleteMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    const { fileId } = req.params;
    if (!fileId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "File ID is required",
      });
      return;
    }

    const organizationId = user.organizationId;
    let deletedUrls: string[] = [];
    let isDeleted = false;

    // 1. Try to fetch and delete from the 'files' table (New structured system)
    const fileRecord = await database.query.files.findFirst({
      where: and(
        eq(files.id, fileId),
        eq(files.organizationId, organizationId)
      ),
    });

    if (fileRecord) {
      // Enforce ownership: only the uploader (or superadmin) may delete
      if (!user.isSuperAdmin && fileRecord.uploadedBy !== user.id) {
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "You can only delete files you uploaded",
        });
        return;
      }

      // Find all versions to delete from Cloudinary
      const versions = await database.select().from(fileVersions).where(eq(fileVersions.fileId, fileId));
      for (const v of versions) {
        if (v.url) deletedUrls.push(v.url);
      }
      
      // Delete the file record (fileVersions will CASCADE delete in DB)
      await database.delete(files).where(eq(files.id, fileId));
      isDeleted = true;
    } else {
      // 2. Try to fetch and delete from legacy 'tasks.attachments'
      // We search all tasks in the org to see if any has an attachment with the given fileId
      const orgProjects = await database.select({ id: projects.id })
        .from(projects)
        .where(eq(projects.organizationId, organizationId));
        
      const orgProjectIds = orgProjects.map(p => p.id);
      
      if (orgProjectIds.length > 0) {
        // Query tasks whose attachments might contain the fileId
        const tasksWithPotentialAttachments = await database.select().from(tasks).where(
          sql`${tasks.attachments}::text LIKE ${`%${fileId}%`}`
        );
  
        // Filter by org's projects
        const relevantTasks = tasksWithPotentialAttachments.filter(t => orgProjectIds.includes(t.projectId));
  
        for (const t of relevantTasks) {
          if (t.attachments && Array.isArray(t.attachments)) {
            const initialLength = t.attachments.length;
            const newAttachments = t.attachments.filter((a: any) => {
              if (a.id === fileId) {
                if (a.url) deletedUrls.push(a.url);
                return false; // Remove this attachment
              }
              return true; // Keep others
            });
            
            if (newAttachments.length !== initialLength) {
              await database.update(tasks)
                .set({ attachments: newAttachments })
                .where(eq(tasks.id, t.id));
              isDeleted = true;
            }
          }
        }
      }

      // 3. Try to fetch and delete from legacy 'projects' (projectFiles and contractfile)
      if (!isDeleted) {
        const possibleProjects = await database.select().from(projects)
          .where(eq(projects.organizationId, organizationId));
        
        for (const p of possibleProjects) {
          let updated = false;
          let newProjectFiles = p.projectFiles ? { ...p.projectFiles } as any : null;
          let newContractfile = p.contractfile;
          let newContractfilePublicId = p.contractfilePublicId;
  
          // Check projectFiles.projectPdf
          if (
            p.projectFiles &&
            p.projectFiles.projectPdf &&
            (p.projectFiles.projectPdf.publicId === fileId || `proj_${p.id}_pdf` === fileId)
          ) {
            if (p.projectFiles.projectPdf.url) deletedUrls.push(p.projectFiles.projectPdf.url);
            delete newProjectFiles.projectPdf;
            updated = true;
          }
  
          // Check contractfile
          if (
            p.contractfile &&
            (p.contractfilePublicId === fileId || `proj_${p.id}_contract` === fileId)
          ) {
            deletedUrls.push(p.contractfile);
            newContractfile = null;
            newContractfilePublicId = null;
            updated = true;
          }
  
          if (updated) {
            await database.update(projects)
              .set({
                projectFiles: newProjectFiles,
                contractfile: newContractfile,
                contractfilePublicId: newContractfilePublicId as any,
              })
              .where(eq(projects.id, p.id));
            isDeleted = true;
          }
        }
      }
    }

    if (!isDeleted && deletedUrls.length === 0) {
      res.status(status.NOT_FOUND).json({
        success: false,
        message: "Media not found or you don't have permission to delete it",
      });
      return;
    }

    // 4. Delete the files from Cloudinary
    for (const url of deletedUrls) {
      if (typeof url === "string") {
        const publicIdMatch = url.match(/\/v\d+\/([^/.]+)/);
        if (publicIdMatch) {
          const publicId = publicIdMatch[1];
          // Determine type based on extension (simple heuristic)
          const isPdf = url.toLowerCase().endsWith(".pdf");
          const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url);
          const resourceType = isImage ? "image" : isPdf ? "image" : "raw"; // Cloudinary treats PDFs as images sometimes
          
          try {
            await deleteSingleResouceFromCloudinary(publicId, resourceType as any);
          } catch (cloudError) {
            // Some PDFs might be uploaded as "raw" type instead
            if (resourceType === "image") {
              try {
                await deleteSingleResouceFromCloudinary(publicId, "raw");
              } catch (rawError) {
                logger.warn(`Failed to delete file from cloudinary (tried both image and raw): ${publicId}`);
              }
            } else {
              logger.warn(`Failed to delete file from cloudinary: ${publicId}`);
            }
          }
        }
      }
    }

    res.status(status.OK).json({
      success: true,
      message: "Media deleted successfully",
    });
  } catch (error) {
    logger.error("Error in deleteMedia controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to delete media file",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
