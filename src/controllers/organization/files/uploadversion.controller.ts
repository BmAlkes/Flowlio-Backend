import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { files, fileVersions } from "@/schema/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import status from "http-status";
import { logger } from "@/utils/logger.util";

/**
 * POST /api/attachments/:id/versions
 * Uploads a new version of a file.
 * Automatically migrates legacy attachments from JSON fields if they don't exist in 'files' table.
 */
export const uploadVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id: attachmentId } = req.params;
    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({ 
        success: false, 
        message: "User not authenticated" 
      });
      return;
    }

    const organizationId = user.organizationId;
    if (!organizationId) {
       res.status(status.BAD_REQUEST).json({ 
        success: false, 
        message: "Organization context is missing" 
      });
      return;
    }

    // 1. Try to find the file in the new structured table
    let fileRecord = await database.query.files.findFirst({
      where: and(eq(files.id, attachmentId), eq(files.organizationId, organizationId)),
      with: {
        versions: {
          orderBy: [desc(fileVersions.versionNumber)],
          limit: 1
        }
      }
    });

    let lastVersionNumber = 0;

    if (fileRecord) {
      lastVersionNumber = fileRecord.versions[0]?.versionNumber || 0;
    } else {
      logger.info(`Searching legacy sources for attachmentId: ${attachmentId}`);
      // 2. Backward Compatibility: Search legacy attachments in tasks.attachments (JSONB array)
      const taskWithAttachment = await database.execute(sql`
        SELECT t.id as task_id, t.attachments, t.project_id, t.created_by, t.created_at
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        WHERE p.organization_id = ${organizationId}
        AND t.attachments IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(t.attachments::jsonb) AS elem 
          WHERE elem->>'id' = ${attachmentId}
        )
        LIMIT 1
      `);

      if (taskWithAttachment.rows.length > 0) {
        const row = taskWithAttachment.rows[0] as any;
        const legacyAttachments = row.attachments as any[];
        const legacyAttachment = legacyAttachments.find((a: any) => a.id === attachmentId);

        logger.info(`Found legacy task attachment in task ${row.task_id}. Migrating...`);

        // Migrate legacy attachment to 'files' and 'file_versions' tables
        const newFileRes = await database.insert(files).values({
          id: attachmentId, // Preserve original ID
          name: legacyAttachment.name,
          organizationId: organizationId,
          projectId: row.project_id,
          taskId: row.task_id,
          uploadedBy: row.created_by || user.id,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
        }).returning();

        fileRecord = { ...newFileRes[0], versions: [] };

        const v1 = await database.insert(fileVersions).values({
          fileId: attachmentId,
          url: legacyAttachment.url,
          name: legacyAttachment.name,
          size: legacyAttachment.size || 0,
          type: legacyAttachment.type || "application/octet-stream",
          versionNumber: 1,
          uploadedBy: row.created_by || user.id,
          createdAt: row.created_at ? new Date(row.created_at) : new Date(),
        }).returning();
        
        fileRecord.versions = v1;
        lastVersionNumber = 1;
        logger.info(`Successfully migrated legacy task attachment ${attachmentId}.`);
      } else {
        // 3. Search in projects.projectFiles or projects.contractfile
        const projectIdFromId = attachmentId.replace('proj_', '').replace('_pdf', '').replace('_contract', '').replace('contract-', '');
        logger.info(`Searching legacy projects for attachmentId: ${attachmentId}, fallback projectId: ${projectIdFromId}`);

        const projectWithFile = await database.execute(sql`
            SELECT id, name, organization_id, project_files, contractfile, contractfile_public_id, created_by, created_at
            FROM projects
            WHERE organization_id = ${organizationId}
            AND (
                (project_files::jsonb->'projectPdf'->>'publicId' = ${attachmentId}) OR
                (project_files::jsonb->'projectPdf'->>'url' = ${attachmentId}) OR
                (id = ${projectIdFromId})
            )
            LIMIT 1
        `);

        if (projectWithFile.rows.length > 0) {
            const row = projectWithFile.rows[0] as any;
            let fileName = "Project File";
            let fileUrl = "";
            let fileSize = 0;
            let fileType = "application/pdf";

            if (row.project_files?.projectPdf && (row.project_files.projectPdf.publicId === attachmentId || row.project_files.projectPdf.url === attachmentId)) {
                fileName = row.project_files.projectPdf.name;
                fileUrl = row.project_files.projectPdf.url;
                fileSize = row.project_files.projectPdf.size || 0;
                fileType = row.project_files.projectPdf.type || "application/pdf";
            } else if (row.contractfile) {
                fileName = "Contract File";
                fileUrl = row.contractfile;
                fileType = "application/pdf";
            } else {
               res.status(status.NOT_FOUND).json({ success: false, message: "File data not found in project fields" });
               return;
            }

            logger.info(`Found legacy project file. Migrating...`);

            const newFileRes = await database.insert(files).values({
                id: attachmentId,
                name: fileName,
                organizationId: organizationId,
                projectId: row.id,
                uploadedBy: row.created_by || user.id,
                createdAt: row.created_at ? new Date(row.created_at) : new Date(),
            }).returning();

            fileRecord = { ...newFileRes[0], versions: [] };

            const v1 = await database.insert(fileVersions).values({
                fileId: attachmentId,
                url: fileUrl,
                name: fileName,
                size: fileSize,
                type: fileType,
                versionNumber: 1,
                uploadedBy: row.created_by || user.id,
                createdAt: row.created_at ? new Date(row.created_at) : new Date(),
            }).returning();

            fileRecord.versions = v1;
            lastVersionNumber = 1;
            logger.info(`Successfully migrated legacy project file ${attachmentId}.`);
        } else {
            logger.warn(`AttachmentId ${attachmentId} not found in any source for organization ${organizationId}`);
            res.status(status.NOT_FOUND).json({ 
                success: false, 
                message: "Original file not found in tasks or projects" 
            });
            return;
        }
      }
    }

    // 3. Process the new version upload
    const multerFile = (req as any).file;
    const base64File = req.body.file;
    const fileToUpload = multerFile || base64File;

    if (!fileToUpload) {
      res.status(status.BAD_REQUEST).json({ 
        success: false, 
        message: "No file provided for version update" 
      });
      return;
    }

    // Adapt multer file for uploadToCloudinary which expects 'filepath' property
    if (multerFile && !multerFile.filepath) {
      multerFile.filepath = multerFile.path;
    }

    // Upload new version to Cloudinary
    const uploadResult = await uploadToCloudinary(fileToUpload, "attachments");

    // 4. Create new version record
    const newVersionNumber = lastVersionNumber + 1;
    await database.insert(fileVersions).values({
      fileId: fileRecord.id,
      url: uploadResult.secure_url,
      name: (multerFile?.originalname || req.body.name || fileRecord.name),
      size: (multerFile?.size || req.body.size || 0),
      type: (multerFile?.mimetype || req.body.type || "application/octet-stream"),
      versionNumber: newVersionNumber,
      uploadedBy: user.id,
    });

    // 5. Fetch updated file with all versions sorted
    const updatedFile = await database.query.files.findFirst({
      where: eq(files.id, fileRecord.id),
      with: {
        uploader: {
           columns: { id: true, name: true, email: true }
        },
        versions: {
          orderBy: [desc(fileVersions.versionNumber)],
          with: {
            uploader: {
               columns: { id: true, name: true, email: true }
            }
          }
        },
      },
    });

    res.status(status.OK).json({
      success: true,
      message: "New version uploaded successfully",
      data: updatedFile,
    });

  } catch (error: any) {
    logger.error("Error in uploadVersion controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: "Failed to upload new version",
      error: error.message || "Unknown error",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      hint: error.message?.includes("relation") ? "Did you run 'npm run dbpush' to create the new tables?" : undefined
    });
  }
};
