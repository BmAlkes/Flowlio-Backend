import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { files, fileVersions, tasks, projects, clients } from "@/schema/schema";
import { eq, and, gte, lte } from "drizzle-orm";
import status from "http-status";
import { logger } from "@/utils/logger.util";

/**
 * GET /api/media OR GET /api/clients/:clientId/media
 * Returns all media (images and PDFs) associated with a client, project, or task.
 * Dynamically combines structured files and legacy JSON-based attachments.
 */
export const getMedia = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({ 
        success: false, 
        message: "User not authenticated" 
      });
      return;
    }

    const organizationId = user.organizationId;
    const { projectId, taskId, startDate, endDate, clientId: queryClientId } = req.query;
    const pathClientId = req.params.clientId;
    let clientId = pathClientId || queryClientId;

    // SECURITY: If user is a client, strictly enforce their own clientId
    if (user.role === "client") {
      // In auth.middleware, clientRecord is attached to req.user for clients
      const authenticatedClientId = user.clientId || user.clientRecord?.id;
      if (authenticatedClientId) {
        clientId = authenticatedClientId;
      } else {
        // If we can't identify the client ID but the user is a client,
        // we must restrict access for security.
        res.status(status.FORBIDDEN).json({
          success: false,
          message: "Client identity could not be verified"
        });
        return;
      }
    }

    const supportedExtensions = ["jpg", "jpeg", "png", "gif", "pdf", "webp", "svg", "docx", "xlsx", "csv", "pptx", "txt"];
    const supportedMimeTypes = [
      "image/jpeg", "image/png", "image/gif", "application/pdf", "image/webp", "image/svg+xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain"
    ];

    const results: any[] = [];
    const seenUrls = new Set<string>();

    // 1. Fetch from 'files' table (New structured system)
    const filesConditions = [eq(files.organizationId, organizationId)];
    if (projectId) filesConditions.push(eq(files.projectId, projectId as string));
    if (taskId) filesConditions.push(eq(files.taskId, taskId as string));
    if (clientId) filesConditions.push(eq(files.clientId, clientId as string));
    if (startDate) filesConditions.push(gte(fileVersions.createdAt, new Date(startDate as string)));
    if (endDate) filesConditions.push(lte(fileVersions.createdAt, new Date(endDate as string)));

    const allStructuredFiles = await database.select({
      fileId: files.id,
      fileName: fileVersions.name, // Show specific version name
      projectId: files.projectId,
      taskId: files.taskId,
      clientId: files.clientId,
      uploadedBy: fileVersions.uploadedBy,
      createdAt: fileVersions.createdAt, // Use version creation time
      url: fileVersions.url,
      type: fileVersions.type,
      versionNumber: fileVersions.versionNumber,
      projectName: projects.name,
      clientName: clients.name
    })
    .from(files)
    .innerJoin(fileVersions, eq(files.id, fileVersions.fileId))
    .leftJoin(projects, eq(files.projectId, projects.id))
    .leftJoin(clients, eq(files.clientId, clients.id))
    .where(and(...filesConditions));

    for (const file of allStructuredFiles) {
      const isSupported = supportedMimeTypes.includes(file.type) || 
                         supportedExtensions.some(ext => file.fileName.toLowerCase().endsWith(ext));
      
      if (isSupported && !seenUrls.has(file.url)) {
        seenUrls.add(file.url);
        results.push({
          fileId: file.fileId,
          fileName: file.fileName,
          fileType: file.type,
          fileUrl: file.url,
          projectId: file.projectId,
          projectName: file.projectName,
          taskId: file.taskId,
          clientId: file.clientId,
          clientName: file.clientName,
          uploadedBy: file.uploadedBy,
          createdAt: file.createdAt,
          latestVersion: file.versionNumber // In this context, it's the specific version number
        });
      }
    }

    // 2. Fetch from legacy 'tasks.attachments' (JSONB)
    const taskConditions = [eq(projects.organizationId, organizationId)];
    if (projectId) taskConditions.push(eq(tasks.projectId, projectId as string));
    if (taskId) taskConditions.push(eq(tasks.id, taskId as string));
    if (clientId) taskConditions.push(eq(projects.clientId, clientId as string));
    if (startDate) taskConditions.push(gte(tasks.createdAt, new Date(startDate as string)));
    if (endDate) taskConditions.push(lte(tasks.createdAt, new Date(endDate as string)));

    const legacyTasks = await database.select({
      task: tasks,
      project: projects,
      client: clients
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...taskConditions));

    legacyTasks.forEach(row => {
      const task = row.task;
      if (task.attachments && Array.isArray(task.attachments)) {
        task.attachments.forEach((att: any) => {
          const type = att.type || "unknown/unknown";
          const name = att.name || "unnamed";
          const isSupported = supportedMimeTypes.includes(type) || 
                             supportedExtensions.some(ext => name.toLowerCase().endsWith(ext));
          
          if (isSupported && !seenUrls.has(att.url)) {
            seenUrls.add(att.url);
            results.push({
              fileId: att.id,
              fileName: name,
              fileType: type,
              fileUrl: att.url,
              projectId: task.projectId,
              projectName: row.project.name,
              taskId: task.id,
              clientId: row.project.clientId,
              clientName: row.client?.name || null,
              uploadedBy: task.createdBy,
              createdAt: task.createdAt,
              latestVersion: 1
            });
          }
        });
      }
    });

    // 3. Fetch from legacy 'projects' (projectFiles and contractfile)
    const projectConditions = [eq(projects.organizationId, organizationId)];
    if (projectId) projectConditions.push(eq(projects.id, projectId as string));
    if (clientId) projectConditions.push(eq(projects.clientId, clientId as string));
    if (startDate) projectConditions.push(gte(projects.createdAt, new Date(startDate as string)));
    if (endDate) projectConditions.push(lte(projects.createdAt, new Date(endDate as string)));

    const legacyProjects = await database.select({
        project: projects,
        client: clients
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .where(and(...projectConditions));

    legacyProjects.forEach(row => {
      const proj = row.project;
      
      // Check projectFiles (JSONB)
      if (proj.projectFiles && proj.projectFiles.projectPdf) {
        const att = proj.projectFiles.projectPdf;
        const isSupported = supportedMimeTypes.includes(att.type) || 
                           supportedExtensions.some(ext => att.name.toLowerCase().endsWith(ext));

        if (isSupported && !seenUrls.has(att.url)) {
          seenUrls.add(att.url);
          results.push({
            fileId: att.publicId || `proj_${proj.id}_pdf`,
            fileName: att.name,
            fileType: "application/pdf",
            fileUrl: att.url,
            projectId: proj.id,
            projectName: proj.name,
            taskId: null,
            clientId: proj.clientId,
            clientName: row.client?.name || null,
            uploadedBy: proj.createdBy,
            createdAt: proj.createdAt,
            latestVersion: 1
          });
        }
      }

      // Check contractfile (Single string URL field)
      if (proj.contractfile) {
          const name = "Contract File";
          const isSupported = supportedExtensions.some(ext => proj.contractfile?.toLowerCase().endsWith(ext)) || 
                             proj.contractfile.includes("res.cloudinary.com");

          if (isSupported && !seenUrls.has(proj.contractfile)) {
            seenUrls.add(proj.contractfile);
            results.push({
              fileId: proj.contractfilePublicId || `proj_${proj.id}_contract`,
              fileName: name,
              fileType: "application/pdf",
              fileUrl: proj.contractfile,
              projectId: proj.id,
              projectName: proj.name,
              taskId: null,
              clientId: proj.clientId,
              clientName: row.client?.name || null,
              uploadedBy: proj.createdBy,
              createdAt: proj.createdAt,
              latestVersion: 1
            });
          }
      }
    });

    // Sort combined results by createdAt descending
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.status(status.OK).json({
      success: true,
      data: results
    });

  } catch (error) {
    logger.error("Error in getMedia controller:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ 
      success: false, 
      message: "Failed to fetch media center data",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
};
