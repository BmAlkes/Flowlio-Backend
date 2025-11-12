import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";

// GET All organizations
export const getAllOrganizations = async (_: Request, res: Response) => {
  try {
    const allOrgs = await database.query.organizations.findMany({
      with: {
        userOrganizations: {
          with: {
            user: true,
          },
        },
        subscriptionPlan: true,
        subscriptions: {
          where: (subs, { eq }) => eq(subs.status, "active"),
          // Get all active subscriptions, we'll sort in application code
        },
      },
    });

    // Sort subscriptions by createdAt descending and take the most recent one for each org
    // This ensures we get the price from the subscription that was actually paid for
    const orgsWithSortedSubscriptions = allOrgs.map((org) => {
      if (org.subscriptions && org.subscriptions.length > 0) {
        // Sort subscriptions by createdAt descending and take the first (most recent)
        const sortedSubs = [...org.subscriptions].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        return {
          ...org,
          subscriptions: [sortedSubs[0]], // Keep only the most recent subscription
        };
      }
      return org;
    });

    logger.info(
      `Total organizations in database: ${orgsWithSortedSubscriptions.length}`
    );
    logger.info(
      "All organizations:",
      JSON.stringify(orgsWithSortedSubscriptions, null, 2)
    );

    return res.status(200).json({
      success: true,
      message: "All organizations retrieved successfully",
      data: orgsWithSortedSubscriptions,
    });
  } catch (error) {
    logger.error("Error retrieving all organizations:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving organizations",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
