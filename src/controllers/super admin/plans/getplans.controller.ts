import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
// import { subscriptionPlans } from "@/schema/schema";
import { logger } from "@/utils/logger.util";

// Get all plans
export const getAllPlans = async (_: Request, res: Response) => {
  try {
    // Use connection pool directly for reliable queries
    // First, verify the column exists by checking the table structure
    const columnCheck = await connection.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'subscription_plans' 
      AND column_name = 'custom_plan_name'
    `);

    logger.info("Column check for custom_plan_name:", {
      exists: columnCheck.rows.length > 0,
      columnInfo: columnCheck.rows,
    });

    const query = `
      SELECT 
        id,
        name,
        slug,
        description,
        custom_plan_name AS "customPlanName",
        price,
        currency,
        billing_cycle AS "billingCycle",
        duration_value AS "durationValue",
        duration_type AS "durationType",
        features,
        is_active AS "isActive",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plans
      ORDER BY sort_order, name
    `;

    logger.info("Executing query to fetch plans with custom_plan_name");

    const plansData = await connection.query(query);

    // Check if custom_plan_name column exists in the raw result
    const plans = plansData.rows.map((plan: any) => {
      // Handle both aliased and snake_case column names
      const durationValue = plan.durationValue ?? plan.duration_value;
      const durationType = plan.durationType ?? plan.duration_type;

      return {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        customPlanName: plan.customPlanName ?? plan.custom_plan_name ?? null,
        price: plan.price,
        currency: plan.currency,
        billingCycle: plan.billingCycle ?? plan.billing_cycle,
        durationValue:
          durationValue !== null && durationValue !== undefined
            ? Number(durationValue)
            : null,
        durationType: durationType,
        features: plan.features,
        isActive: plan.isActive ?? plan.is_active,
        sortOrder: plan.sortOrder ?? plan.sort_order,
        createdAt: plan.createdAt ?? plan.created_at,
        updatedAt: plan.updatedAt ?? plan.updated_at,
      };
    });

    return res.status(200).json({
      success: true,
      message: "Subscription plans retrieved successfully",
      data: plans,
    });
  } catch (error) {
    logger.error("Error retrieving subscription plans:", error);
    if (error instanceof Error) {
      logger.error("Error message:", error.message);
      logger.error("Error stack:", error.stack);
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error while retrieving subscription plans",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Get public plans (active plans only for pricing page)
export const getPublicPlans = async (_: Request, res: Response) => {
  try {
    console.log("🔍 Fetching public plans...");
    logger.info("Fetching public plans...");

    // Use connection pool directly for reliable queries
    const query = `
      SELECT 
        id,
        name,
        slug,
        description,
        custom_plan_name AS "customPlanName",
        price,
        currency,
        billing_cycle AS "billingCycle",
        duration_value AS "durationValue",
        duration_type AS "durationType",
        features,
        is_active AS "isActive",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plans
      WHERE is_active = true
      ORDER BY sort_order, name
    `;

    const plansData = await connection.query(query);

    console.log("📥 Raw public plans data from DB:", {
      rowCount: plansData.rows.length,
      firstRow: plansData.rows[0]
        ? {
            allKeys: Object.keys(plansData.rows[0]),
            durationValue: plansData.rows[0].durationValue,
            durationType: plansData.rows[0].durationType,
            duration_value: plansData.rows[0].duration_value,
            duration_type: plansData.rows[0].duration_type,
            fullRow: JSON.stringify(plansData.rows[0], null, 2),
          }
        : null,
    });

    const plans = plansData.rows.map((plan: any) => {
      // Handle both aliased and snake_case column names
      const durationValue = plan.durationValue ?? plan.duration_value;
      const durationType = plan.durationType ?? plan.duration_type;

      return {
        id: plan.id,
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        customPlanName: plan.customPlanName ?? plan.custom_plan_name ?? null,
        price: plan.price,
        currency: plan.currency,
        billingCycle: plan.billingCycle ?? plan.billing_cycle,
        durationValue:
          durationValue !== null && durationValue !== undefined
            ? Number(durationValue)
            : null,
        durationType: durationType,
        features: plan.features,
        isActive: plan.isActive ?? plan.is_active,
        sortOrder: plan.sortOrder ?? plan.sort_order,
        createdAt: plan.createdAt ?? plan.created_at,
        updatedAt: plan.updatedAt ?? plan.updated_at,
      };
    });

    const debugLog = {
      count: plans.length,
      sample: plans[0]
        ? {
            name: plans[0].name,
            durationValue: plans[0].durationValue,
            durationType: plans[0].durationType,
            allKeys: Object.keys(plans[0]),
            fullPlan: JSON.stringify(plans[0], null, 2),
          }
        : null,
    };
    console.log("📊 Retrieved public plans:", debugLog);
    logger.info("Retrieved public plans:", debugLog);

    return res.status(200).json({
      success: true,
      message: "Public subscription plans retrieved successfully",
      data: plans,
    });
  } catch (error) {
    logger.error("Error retrieving public subscription plans:", error);

    // Enhanced error logging
    if (error instanceof Error) {
      logger.error("Error name:", error.name);
      logger.error("Error message:", error.message);
      logger.error("Error stack:", error.stack);
    } else {
      logger.error("Error type:", typeof error);
      logger.error("Error value:", JSON.stringify(error, null, 2));
    }

    return res.status(500).json({
      success: false,
      message:
        "Internal server error while retrieving public subscription plans",
      error:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    });
  }
};
