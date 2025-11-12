import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { subscriptionPlans, organizations } from "../../../../drizzle/schema";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";

// Delete Features of All planS
export const deletePlan = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Check if plan exists
    const existingPlan = await database.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, id),
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Check if any organizations are using this plan
    const organizationsUsingPlan = await database.query.organizations.findMany({
      where: eq(organizations.subscriptionPlanId, id),
    });

    if (organizationsUsingPlan.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot delete plan. There are organizations currently using this plan.",
        data: {
          organizationsCount: organizationsUsingPlan.length,
          organizations: organizationsUsingPlan.map((org) => ({
            id: org.id,
            name: org.name,
            slug: org.slug,
          })),
        },
      });
    }

    // Delete the plan
    await database
      .delete(subscriptionPlans)
      .where(eq(subscriptionPlans.id, id));

    logger.info(`Deleted subscription plan: ${existingPlan.name}`);

    return res.status(200).json({
      success: true,
      message: "Subscription plan deleted successfully",
      data: {
        deletedPlan: {
          id: existingPlan.id,
          name: existingPlan.name,
          slug: existingPlan.slug,
        },
      },
    });
  } catch (error) {
    logger.error("Error deleting subscription plan:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting subscription plan",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
