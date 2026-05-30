import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, projects } from "../../../schema/schema";
import { eq, and, like, desc } from "drizzle-orm";

export const getClients = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    // Check if user is authenticated and has organization ID
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const organizationId = req.user.organizationId;

    if (!organizationId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    // Get query parameters for filtering (no pagination)
    const {
      search = "",
      status = "",
      industry = "",
      sortBy = "position",
      sortOrder = "asc",
    } = req.query;

    // Build where conditions
    let whereConditions = [eq(clients.organizationId, organizationId)];

    if (search) {
      whereConditions.push(like(clients.name, `%${search}%`));
    }

    if (status) {
      whereConditions.push(eq(clients.status, status as any));
    }

    if (industry) {
      whereConditions.push(eq(clients.businessIndustry, industry as string));
    }

    // Build order by
    let orderByClause: any;
    const sOrder = sortOrder as string;
    const sBy = sortBy as string;

    switch (sBy) {
      case "name":
        orderByClause = sOrder === "asc" ? clients.name : desc(clients.name);
        break;
      case "email":
        orderByClause = sOrder === "asc" ? clients.email : desc(clients.email);
        break;
      case "status":
        orderByClause = sOrder === "asc" ? clients.status : desc(clients.status);
        break;
      case "position":
        orderByClause = sOrder === "asc" ? clients.position : desc(clients.position);
        break;
      case "createdAt":
      default:
        orderByClause = sOrder === "asc" ? clients.createdAt : desc(clients.createdAt);
        break;
    }

    // Get all clients for the organization (no pagination)
    const clientsList = await database
      .select({
        id: clients.id,
        name: clients.name,
        email: clients.email,
        image: clients.image,
        phone: clients.phone,
        cpfcnpj: clients.cpfcnpj,
        businessIndustry: clients.businessIndustry,
        address: clients.address,
        socialMediaLinks: clients.socialMediaLinks,
        status: clients.status,
        customFields: clients.customFields,
        createdAt: clients.createdAt,
        updatedAt: clients.updatedAt,
        position: clients.position,
        leadValue: clients.leadValue,
        leadTemperature: clients.leadTemperature,
        lastInteractionAt: clients.lastInteractionAt,
        followUpAt: clients.followUpAt,
      })
      .from(clients)
      .where(and(...whereConditions))
      .orderBy(orderByClause);

    // Fetch projects for each client
    const clientsWithProjects = await Promise.all(
      clientsList.map(async (client) => {
        const clientProjects = await database
          .select({
            id: projects.id,
            name: projects.name,
            status: projects.status,
            progress: projects.progress,
            contractfile: projects.contractfile,
            startDate: projects.startDate,
            endDate: projects.endDate,
          })
          .from(projects)
          .where(eq(projects.clientId, client.id));

        // Map projects to match frontend format
        const mappedProjects = clientProjects.map((project) => ({
          id: project.id,
          name: project.name,
          status: project.status || "active",
          completionRate: project.progress || 0,
          contractFile: project.contractfile || "",
        }));

        return {
          ...client,
          projects: mappedProjects,
        };
      }),
    );

    res.status(200).json({
      success: true,
      message: "Clients fetched successfully",
      data: clientsWithProjects,
      total: clientsWithProjects.length,
    });
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({
      error: "Internal server error while fetching clients",
    });
  }
};

// Get a specific client by ID
export const getClientById = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({
        success: false,
        message: "Client ID is required",
      });
    }

    const client = await database.query.clients.findFirst({
      where: (clients, { eq }) => eq(clients.id, clientId),
      with: {
        organization: {
          columns: { id: true, name: true },
        },
      },
    });

    if (!client) {
      return res.status(404).json({
        success: false,
        message: "Client not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Client retrieved successfully",
      data: client,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // logger.error("Error retrieving client:", {
    //   error: message,
    //   clientId: req.params.clientId,
    // });

    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving client",
      error: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
};

// Get client statistics for an organization
export const getClientStats = async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
    }

    // Get all clients for the organization
    const allClients = await database.query.clients.findMany({
      where: (clients, { eq }) => eq(clients.organizationId, organizationId),
      columns: { status: true, createdAt: true },
    });

    // Calculate statistics
    const totalClients = allClients.length;
    const activeClients = allClients.filter(
      (client) => client.status === "Project In Progress" || client.status === "Contract Signed",
    ).length;
    const inactiveClients = allClients.filter(
      (client) => client.status === "Inactive" || client.status === "Lost",
    ).length;
    const prospectClients = allClients.filter(
      (client) => client.status === "Qualified" || client.status === "Contacted",
    ).length;
    const leadClients = allClients.filter(
      (client) => client.status === "New Lead",
    ).length;

    // Calculate monthly growth (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const recentClients = allClients.filter(
      (client) => new Date(client.createdAt) >= sixMonthsAgo,
    );

    const monthlyGrowth = Array.from({ length: 6 }, (_, i) => {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0);
      monthEnd.setHours(23, 59, 59, 999);

      const count = recentClients.filter(
        (client) =>
          new Date(client.createdAt) >= monthStart &&
          new Date(client.createdAt) <= monthEnd,
      ).length;

      return {
        month: monthStart.toLocaleString("default", {
          month: "short",
          year: "numeric",
        }),
        count,
      };
    }).reverse();

    return res.status(200).json({
      success: true,
      message: "Client statistics retrieved successfully",
      data: {
        totalClients,
        statusBreakdown: {
          active: activeClients,
          inactive: inactiveClients,
          prospect: prospectClients,
          lead: leadClients,
        },
        monthlyGrowth,
        conversionRate:
          totalClients > 0
            ? ((activeClients / totalClients) * 100).toFixed(1)
            : "0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // logger.error("Error retrieving client statistics:", {
    //   error: message,
    //   organizationId: req.params.organizationId,
    // });

    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving client statistics",
      error: process.env.NODE_ENV === "development" ? message : undefined,
    });
  }
};
