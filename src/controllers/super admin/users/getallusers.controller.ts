import { database } from "@/configs/connection.config";
import { users, userOrganizations, organizations, clients } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";
import { eq, desc } from "drizzle-orm";

export const getAllUsers = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { page = "1", limit = "50", search = "" } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    logger.info("📊 getAllUsers called for superadmin", {
      page: pageNum,
      limit: limitNum,
      search: search as string,
    });

    // Get all users with their organization info
    // Note: For better search performance, consider using full-text search or ILIKE with raw SQL
    const allUsers = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        image: users.image,
        role: users.role,
        isSuperAdmin: users.isSuperAdmin,
        subadminId: users.subadminId,
        timezone: users.timezone,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // Filter by search term if provided (client-side filtering for now)
    // For production with large datasets, implement server-side search using ILIKE
    const filteredUsers =
      search && typeof search === "string"
        ? allUsers.filter(
            (user) =>
              user.name?.toLowerCase().includes(search.toLowerCase()) ||
              user.email?.toLowerCase().includes(search.toLowerCase())
          )
        : allUsers;

    // Apply pagination after filtering
    const paginatedUsers = filteredUsers.slice(offset, offset + limitNum);

    // Get organization info for each user
    const usersWithOrganizations = await Promise.all(
      paginatedUsers.map(async (user) => {
        // Users with role "client" are linked via the clients table (clients.userId),
        // not via userOrganizations. Build the same shape for both paths.
        let userOrgs: {
          organizationId: string;
          role: string;
          status: string | null;
          organization: { id: string; name: string; slug: string };
        }[];

        if (user.role === "client") {
          const clientRows = await database
            .select({
              organizationId: clients.organizationId,
              organization: {
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
              },
            })
            .from(clients)
            .innerJoin(organizations, eq(clients.organizationId, organizations.id))
            .where(eq(clients.userId, user.id));

          userOrgs = clientRows.map((r) => ({
            organizationId: r.organizationId,
            role: "client",
            status: "active",
            organization: r.organization,
          }));
        } else {
          userOrgs = await database
            .select({
              organizationId: userOrganizations.organizationId,
              role: userOrganizations.role,
              status: userOrganizations.status,
              organization: {
                id: organizations.id,
                name: organizations.name,
                slug: organizations.slug,
              },
            })
            .from(userOrganizations)
            .innerJoin(
              organizations,
              eq(userOrganizations.organizationId, organizations.id)
            )
            .where(eq(userOrganizations.userId, user.id));
        }

        return {
          ...user,
          organizations: userOrgs,
          organizationCount: userOrgs.length,
        };
      })
    );

    // Total count is the filtered users count
    const totalCount = filteredUsers.length;

    logger.info(
      `✅ Fetched ${usersWithOrganizations.length} users (total: ${totalCount})`
    );

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: {
        users: usersWithOrganizations,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalCount / limitNum),
          totalUsers: totalCount,
          limit: limitNum,
          hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
          hasPrevPage: pageNum > 1,
        },
      },
    });
  } catch (error) {
    logger.error("Error fetching all users:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
