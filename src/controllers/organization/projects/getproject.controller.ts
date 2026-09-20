import { listProjects, findProject } from "@/modules/projects/read-projects";
import { database } from "@/configs/connection.config";
import { clients, users, userOrganizations, userManagement } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, desc } from "drizzle-orm";
import status from "http-status";

export const getAllProjects = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("🔍 getAllProjects called with user:", req.user);

    if (!req.user?.organizationId) {
      logger.error("❌ No organization ID found in request");
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user?.organizationId as string;
    logger.info("🏢 Organization ID:", organizationId);

    const transformedProjects = await listProjects(req.user);

    logger.info(
      `Fetched ${transformedProjects.length} projects for organization ${organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Projects fetched successfully",
      data: transformedProjects,
    });
  } catch (error) {
    logger.error("Error fetching projects:", error);
    console.error("Full error:", error);
    res.status(500).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getProjectById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        success: false,
        message: "Project ID is required",
      });
      return;
    }

    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const transformedProject = await findProject(req.user, id);
    if (!transformedProject) {
      res.status(404).json({ success: false, message: "Project not found" });
      return;
    }

    logger.info(
      `Fetched project ${id} for organization ${req.user.organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Project fetched successfully",
      data: transformedProject,
    });
  } catch (error) {
    logger.error("Error fetching project:", error);
    console.error("Full error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getOrganizationClients = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user.organizationId;

    const clientsData = await database
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        phone: clients.phone,
        address: clients.address,
        organizationId: clients.organizationId,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
      })
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .orderBy(desc(clients.createdAt));

    logger.info(
      `Fetched ${clientsData.length} clients for organization ${organizationId}`,
    );

    res.status(200).json({
      success: true,
      message: "Clients fetched successfully",
      data: clientsData,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

export const getOrganizationUsers = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user?.organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    const organizationId = req.user.organizationId;

    type UserRow = {
      id: string;
      name: string | null;
      email: string;
      role: string | null;
      organizationId: string;
      createdAt: Date;
      updatedAt: Date;
    };

    const seenIds = new Set<string>();
    const result: UserRow[] = [];

    // Source 1 — users in userOrganizations (the org owner).
    // No role filter: the owner's role string varies across orgs.
    const uoUsers = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: userOrganizations.role,
        organizationId: userOrganizations.organizationId,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .innerJoin(userOrganizations, eq(users.id, userOrganizations.userId))
      .where(eq(userOrganizations.organizationId, organizationId));

    for (const u of uoUsers) {
      if (!seenIds.has(u.id)) {
        result.push(u);
        seenIds.add(u.id);
      }
    }

    // Source 2 — users in userManagement (invited team members).
    // They are not in userOrganizations; bridge to users table via email.
    const teamMembers = await database
      .select({
        email: userManagement.email,
        userrole: userManagement.userrole,
        createdAt: userManagement.createdAt,
        updatedAt: userManagement.updatedAt,
      })
      .from(userManagement)
      .where(eq(userManagement.organizationId, organizationId));

    for (const member of teamMembers) {
      const userRow = await database.query.users.findFirst({
        where: (u, { eq: eqFn }) => eqFn(u.email, member.email),
      });
      if (!userRow || seenIds.has(userRow.id)) continue;

      result.push({
        id: userRow.id,
        name: userRow.name,
        email: userRow.email,
        role: member.userrole,
        organizationId,
        createdAt: userRow.createdAt,
        updatedAt: userRow.updatedAt,
      });
      seenIds.add(userRow.id);
    }

    // Sort newest-first, matching the original ordering
    result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    logger.info(
      `Fetched ${result.length} users for organization ${organizationId} (${uoUsers.length} via userOrganizations, ${teamMembers.length} via userManagement)`,
    );

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: result,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
