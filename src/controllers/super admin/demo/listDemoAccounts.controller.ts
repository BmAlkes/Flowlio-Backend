import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { organizations, userOrganizations, users } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq } from "drizzle-orm";

export const listDemoAccounts = async (_req: Request, res: Response) => {
  try {
    const orgs = await database
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        status: organizations.status,
        subscriptionStatus: organizations.subscriptionStatus,
        trialEndsAt: organizations.trialEndsAt,
        settings: organizations.settings,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
      })
      .from(organizations);

    // Filter demo orgs in memory to avoid driver-specific JSON operators
    const filtered = orgs.filter((o: any) => o?.settings?.demo === true);

    // Fetch user info for each demo org
    const orgsWithUsers = await Promise.all(
      filtered.map(async (org: any) => {
        const orgUsers = await database
          .select({
            email: users.email,
            name: users.name,
            role: userOrganizations.role,
            userId: users.id,
          })
          .from(userOrganizations)
          .innerJoin(users, eq(userOrganizations.userId, users.id))
          .where(eq(userOrganizations.organizationId, org.id))
          .limit(1);

        return {
          ...org,
          email: orgUsers[0]?.email || null,
          userName: orgUsers[0]?.name || null,
          userRole: orgUsers[0]?.role || null,
          userId: orgUsers[0]?.userId || null,
          demoRole: (org.settings as any)?.demoRole || null,
          demoCreatedAt: (org.settings as any)?.demoCreatedAt || null,
        };
      })
    );

    res.status(status.OK).json({ success: true, data: orgsWithUsers });
  } catch (error) {
    logger.error("Error listing demo accounts:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
