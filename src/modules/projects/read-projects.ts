import { projectReadScope, projectBudget } from "@/security/resource-access";
import type { Actor } from "@/security/resource-policy";
import { database } from "@/configs/connection.config";
import { projects, clients, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { eq, desc, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

export async function listProjects(actor: Actor) {
  // Create aliases for users table to avoid conflicts
  const assignedUsers = alias(users, "assigned_users");
  const createdByUsers = alias(users, "created_by_users");

  logger.info("🔍 About to execute database query with joins...");

  const whereConditions = [projectReadScope(actor)];

  const projectsData = await database
    .select({
      // ... (all fields)
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      description: projects.description,
      startDate: projects.startDate,
      endDate: projects.endDate,
      assignedTo: projects.assignedTo,
      status: projects.status,
      progress: projects.progress,
      address: projects.address,
      budget: projects.budget,
      contractfile: projects.contractfile,
      projectFiles: projects.projectFiles,
      createdBy: projects.createdBy,
      organizationId: projects.organizationId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      clientId: projects.clientId,
      clientName: clients.name,
      clientEmail: clients.email,
      assignedUserName: assignedUsers.name,
      assignedUserEmail: assignedUsers.email,
      createdByName: createdByUsers.name,
      createdByEmail: createdByUsers.email,
      visibility: projects.visibility,
      customFields: projects.customFields,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(assignedUsers, eq(projects.assignedTo, assignedUsers.id))
    .leftJoin(createdByUsers, eq(projects.createdBy, createdByUsers.id))
    .where(and(...whereConditions))
    .orderBy(desc(projects.createdAt));

  logger.info(
    "✅ Simple database query executed successfully. Found projects:",
    projectsData.length,
  );

  // Transform the data to match frontend expectations
  const transformedProjects = projectsData.map((project) => ({
    id: project.id,
    projectNumber: project.projectNumber,
    projectName: project.name,
    clientName: project.clientName || "Unknown Client",
    description: project.description || "",
    startDate: project.startDate ? new Date(project.startDate) : null,
    endDate: project.endDate ? new Date(project.endDate) : null,
    assignedProject: project.assignedUserName || "Unassigned",
    address: project.address || "",
    budget: projectBudget(actor, project.budget),
    status: project.status || "pending",
    progress: project.progress || 0,
    createdBy: project.createdByName || "Unknown",
    organizationId: project.organizationId,
    createdAt: new Date(project.createdAt),
    updatedAt: new Date(project.updatedAt),
    visibility: project.visibility,
    // Additional fields for frontend
    clientId: project.clientId,
    assignedTo: project.assignedTo,
    contractfile: project.contractfile,
    projectFiles: project.projectFiles,
    customFields: project.customFields,
  }));

  return transformedProjects;
}

export async function findProject(actor: Actor, id: string) {
  const organizationId = actor.organizationId!;
  // Create aliases for users table to avoid conflicts
  const assignedUsers = alias(users, "assigned_users");
  const createdByUsers = alias(users, "created_by_users");

  const project = await database
    .select({
      id: projects.id,
      projectNumber: projects.projectNumber,
      name: projects.name,
      description: projects.description,
      startDate: projects.startDate,
      endDate: projects.endDate,
      assignedTo: projects.assignedTo,
      status: projects.status,
      progress: projects.progress,
      address: projects.address,
      budget: projects.budget,
      contractfile: projects.contractfile,
      projectFiles: projects.projectFiles,
      createdBy: projects.createdBy,
      organizationId: projects.organizationId,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      // Client information
      clientId: clients.id,
      clientName: clients.name,
      clientEmail: clients.email,
      clientImage: clients.image,
      // Assigned user information
      assignedUserName: assignedUsers.name,
      assignedUserEmail: assignedUsers.email,
      // Created by user information
      createdByName: createdByUsers.name,
      createdByEmail: createdByUsers.email,
      visibility: projects.visibility,
      customFields: projects.customFields,
    })
    .from(projects)
    .leftJoin(clients, eq(projects.clientId, clients.id))
    .leftJoin(assignedUsers, eq(projects.assignedTo, assignedUsers.id))
    .leftJoin(createdByUsers, eq(projects.createdBy, createdByUsers.id))
    .where(
      and(
        eq(projects.id, id),
        eq(projects.organizationId, organizationId),
        projectReadScope(actor),
      ),
    )
    .limit(1);

  if (!project.length) return null;

  const projectData = project[0];

  const transformedProject = {
    id: projectData.id,
    projectNumber: projectData.projectNumber,
    projectName: projectData.name,
    clientName: projectData.clientName || "Unknown Client",
    clientImage: projectData.clientImage,
    description: projectData.description || "",
    startDate: projectData.startDate ? new Date(projectData.startDate) : null,
    endDate: projectData.endDate ? new Date(projectData.endDate) : null,
    assignedProject: projectData.assignedUserName || "Unassigned",
    address: projectData.address || "",
    budget: projectBudget(actor, projectData.budget),
    status: projectData.status || "pending",
    progress: projectData.progress || 0,
    createdBy: projectData.createdByName || "Unknown",
    organizationId: projectData.organizationId,
    createdAt: new Date(projectData.createdAt),
    updatedAt: new Date(projectData.updatedAt),
    visibility: projectData.visibility,
    // Additional fields
    clientId: projectData.clientId,
    assignedTo: projectData.assignedTo,
    contractfile: projectData.contractfile,
    projectFiles: projectData.projectFiles,
    customFields: projectData.customFields,
  };

  return transformedProject;
}
