import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { files, fileVersions } from "@/schema/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

/**
 * GET /api/attachments/:id/versions
 * Returns the version history for a specific attachment.
 * Supports legacy attachments by returning them as version 1 if no newer versions exist.
 */
export const getVersionHistory = async (req: Request, res: Response): Promise<void> => {
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

    // 1. Try to find in the 'files' table
    const fileRecord = await database.query.files.findFirst({
      where: and(eq(files.id, attachmentId), eq(files.organizationId, organizationId)),
      with: {
        versions: {
          orderBy: [asc(fileVersions.versionNumber)],
          with: {
            uploader: {
               columns: { id: true, name: true, email: true }
            }
          }
        }
      }
    });

    if (fileRecord && fileRecord.versions.length > 0) {
      res.status(status.OK).json({
        success: true,
        data: fileRecord.versions
      });
      return;
    }

    // 2. Backward Compatibility: Search legacy attachments in tasks.attachments (JSONB array)
    const taskWithAttachment = await database.execute(sql`
        SELECT t.id, t.attachments, t.created_by, t.created_at
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
        const task = taskWithAttachment.rows[0] as any;
        const legacyAttachments = task.attachments as any[];
        const legacyAttachment = legacyAttachments.find((a: any) => a.id === attachmentId);

        // Return a virtual version 1
        res.status(status.OK).json({
            success: true,
            data: [{
                versionNumber: 1,
                name: legacyAttachment.name,
                url: legacyAttachment.url,
                size: legacyAttachment.size || 0,
                type: legacyAttachment.type || "application/octet-stream",
                uploadedBy: task.created_by || "System",
                createdAt: task.created_at || new Date()
            }]
        });
        return;
    }

    // 3. Search in projects.projectFiles or projects.contractfile
    const projectIdFromId = attachmentId.replace('proj_', '').replace('_pdf', '').replace('_contract', '').replace('contract-', '');
    const projectWithFile = await database.execute(sql`
        SELECT id, name, organization_id, project_files, contractfile, created_by, created_at
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
        }

        res.status(status.OK).json({
            success: true,
            data: [{
                versionNumber: 1,
                name: fileName,
                url: fileUrl,
                size: fileSize,
                type: fileType,
                uploadedBy: row.created_by || "System",
                createdAt: row.created_at || new Date()
            }]
        });
        return;
    }

    res.status(status.NOT_FOUND).json({ 
      success: false, 
      message: "Attachment not found" 
    });

  } catch (error) {
    logger.error("Error in getVersionHistory controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: "Failed to fetch version history",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
