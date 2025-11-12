import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { subscriptionPlans } from "../../../../drizzle/schema";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";

interface DeleteFeaturesRequest {
  planId: string;
  featuresToDelete: string[]; // Array of custom feature names to delete
}

export const deleteCustomFeatures = async (req: Request, res: Response) => {
  try {
    const { planId, featuresToDelete }: DeleteFeaturesRequest = req.body;

    if (!planId || !featuresToDelete || !Array.isArray(featuresToDelete)) {
      return res.status(400).json({
        success: false,
        message: "Plan ID and features to delete are required",
      });
    }

    // Check if plan exists
    const existingPlan = await database.query.subscriptionPlans.findFirst({
      where: eq(subscriptionPlans.id, planId),
    });

    if (!existingPlan) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    // Get current features
    const currentFeatures = existingPlan.features as any;

    if (!currentFeatures || !currentFeatures.customFeatures) {
      return res.status(400).json({
        success: false,
        message: "No custom features found in this plan",
      });
    }

    // Filter out the features to delete
    const updatedCustomFeatures = currentFeatures.customFeatures.filter(
      (feature: string) => !featuresToDelete.includes(feature)
    );

    // Check if any features were actually deleted
    const deletedFeatures = currentFeatures.customFeatures.filter(
      (feature: string) => featuresToDelete.includes(feature)
    );

    if (deletedFeatures.length === 0) {
      return res.status(400).json({
        success: false,
        message: "None of the specified features were found in this plan",
      });
    }

    // Update the plan with new custom features
    const updatedFeatures = {
      ...currentFeatures,
      customFeatures: updatedCustomFeatures,
    };

    const updatedPlan = await database
      .update(subscriptionPlans)
      .set({
        features: updatedFeatures,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(subscriptionPlans.id, planId))
      .returning();

    logger.info(`Deleted custom features from plan: ${existingPlan.name}`);

    return res.status(200).json({
      success: true,
      message: "Custom features deleted successfully",
      data: {
        plan: updatedPlan[0],
        deletedFeatures,
        remainingCustomFeatures: updatedCustomFeatures,
      },
    });
  } catch (error) {
    logger.error("Error deleting custom features:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting custom features",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
