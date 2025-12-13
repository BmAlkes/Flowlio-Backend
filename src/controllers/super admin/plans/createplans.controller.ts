import { Request, Response } from "express";
import { database, connection } from "@/configs/connection.config";
// import { subscriptionPlans } from "../../../../drizzle/schema";
import { logger } from "@/utils/logger.util";

export interface PlanFeature {
  maxUsers: number;
  maxProjects: number;
  maxStorage: number;
  maxTasks: number;
  aiAssist: boolean;
  prioritySupport: boolean;
  calendarAccess?: boolean;
  taskManagement?: boolean;
  timeTracking?: boolean;
  customFeatures?: string[];
  [key: string]: any;
}

interface CreatePlanRequest {
  name: string;
  slug: string;
  description?: string;
  customPlanName?: string; // Optional custom display name
  price: number;
  currency?: string;
  billingCycle?: "days" | "monthly" | "yearly";
  durationValue?: number | null;
  durationType?: "days" | "monthly" | "yearly" | null;
  trialDays?: number | null; // Number of trial days (0 = no trial, null = default 7)
  features?: PlanFeature;
  isActive?: boolean;
  sortOrder?: number;
}

export const createSinglePlan = async (req: Request, res: Response) => {
  try {
    const planData: CreatePlanRequest = req.body;

    logger.info("Received plan data for CREATE:", {
      name: planData.name,
      slug: planData.slug,
      nameAndSlugMatch:
        planData.name.toLowerCase() === planData.slug.toLowerCase(),
      customPlanName: planData.customPlanName,
      customPlanNameType: typeof planData.customPlanName,
      customPlanNameUndefined: planData.customPlanName === undefined,
      customPlanNameNull: planData.customPlanName === null,
      durationValue: planData.durationValue,
      durationType: planData.durationType,
      fullBody: JSON.stringify(req.body, null, 2),
    });

    // Validate required fields
    if (!planData.name || !planData.slug || !planData.price) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, slug, and price are required",
      });
    }

    // Check if plan with same slug already exists
    const existingPlan = await database.query.subscriptionPlans.findFirst({
      where: (plans, { eq }) => eq(plans.slug, planData.slug),
    });

    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: "A plan with this slug already exists",
        existingPlan: {
          id: existingPlan.id,
          name: existingPlan.name,
          slug: existingPlan.slug,
        },
      });
    }

    // Validate durationValue - REQUIRED FIELD
    let durationValue: number | null = null;
    if (
      planData.durationValue !== undefined &&
      planData.durationValue !== null
    ) {
      if (typeof planData.durationValue === "number") {
        if (!isNaN(planData.durationValue) && planData.durationValue >= 0) {
          durationValue = planData.durationValue;
        } else {
          console.error(
            "❌ Invalid durationValue (number):",
            planData.durationValue
          );
          logger.error(
            "Invalid durationValue (number):",
            planData.durationValue
          );
          return res.status(400).json({
            success: false,
            message: "Invalid durationValue: must be a positive number",
            receivedValue: planData.durationValue,
          });
        }
      } else if (typeof planData.durationValue === "string") {
        const parsed = parseInt(planData.durationValue, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          durationValue = parsed;
        } else {
          console.error(
            "❌ Invalid durationValue (string):",
            planData.durationValue,
            "parsed as:",
            parsed
          );
          logger.error(
            "Invalid durationValue (string):",
            planData.durationValue
          );
          return res.status(400).json({
            success: false,
            message: "Invalid durationValue: must be a valid positive number",
            receivedValue: planData.durationValue,
          });
        }
      } else {
        console.error(
          "❌ Unexpected durationValue type:",
          typeof planData.durationValue,
          "value:",
          planData.durationValue
        );
        logger.error(
          "Unexpected durationValue type:",
          typeof planData.durationValue
        );
        return res.status(400).json({
          success: false,
          message: "Invalid durationValue: must be a number",
          receivedValue: planData.durationValue,
          receivedType: typeof planData.durationValue,
        });
      }
    } else {
      console.error("❌ durationValue is REQUIRED but is undefined or null");
      logger.error("durationValue is REQUIRED but is undefined or null");
      return res.status(400).json({
        success: false,
        message: "durationValue is required and cannot be null",
        receivedValue: planData.durationValue,
      });
    }

    // Validate durationType - REQUIRED FIELD
    let durationType: "days" | "monthly" | "yearly" | null = null;
    if (planData.durationType !== undefined && planData.durationType !== null) {
      if (
        typeof planData.durationType === "string" &&
        planData.durationType.trim() !== ""
      ) {
        const trimmed = planData.durationType.trim();
        if (
          trimmed === "days" ||
          trimmed === "monthly" ||
          trimmed === "yearly"
        ) {
          durationType = trimmed;
        } else {
          console.error(
            "❌ Invalid durationType value:",
            planData.durationType
          );
          logger.error("Invalid durationType value:", planData.durationType);
          return res.status(400).json({
            success: false,
            message:
              "Invalid durationType: must be 'days', 'monthly', or 'yearly'",
            receivedValue: planData.durationType,
          });
        }
      } else {
        console.error(
          "❌ durationType is not a valid string:",
          typeof planData.durationType,
          "value:",
          planData.durationType
        );
        logger.error(
          "durationType is not a valid string:",
          typeof planData.durationType
        );
        return res.status(400).json({
          success: false,
          message:
            "Invalid durationType: must be a string ('days', 'monthly', or 'yearly')",
          receivedValue: planData.durationType,
          receivedType: typeof planData.durationType,
        });
      }
    } else {
      console.error("❌ durationType is REQUIRED but is undefined or null");
      logger.error("durationType is REQUIRED but is undefined or null");
      return res.status(400).json({
        success: false,
        message: "durationType is required and cannot be null",
        receivedValue: planData.durationType,
      });
    }

    // Validate customPlanName - OPTIONAL field
    let customPlanName: string | null = null;
    if (
      planData.customPlanName !== undefined &&
      planData.customPlanName !== null
    ) {
      if (typeof planData.customPlanName === "string") {
        const trimmed = planData.customPlanName.trim();
        // Allow empty string (user cleared the field) or valid non-empty string
        customPlanName = trimmed.length > 0 ? trimmed : null;
        logger.info("CustomPlanName validation (CREATE):", {
          received: planData.customPlanName,
          trimmed: trimmed,
          final: customPlanName,
          length: trimmed.length,
        });
      } else {
        logger.error(
          "Invalid customPlanName type:",
          typeof planData.customPlanName
        );
        return res.status(400).json({
          success: false,
          message: "Invalid customPlanName: must be a string",
          receivedValue: planData.customPlanName,
          receivedType: typeof planData.customPlanName,
        });
      }
    } else {
      logger.info("CustomPlanName validation (CREATE):", {
        received: planData.customPlanName,
        final: null,
        reason: "undefined or null",
      });
    }

    // Use connection pool directly for reliable parameterized queries
    const billingCycleValue =
      planData.billingCycle &&
      (planData.billingCycle === "days" ||
        planData.billingCycle === "monthly" ||
        planData.billingCycle === "yearly")
        ? planData.billingCycle
        : "monthly";
    const featuresForDb = planData.features
      ? JSON.stringify(planData.features)
      : null;
    const now = new Date();

    const trialDaysValue =
      planData.trialDays !== undefined && planData.trialDays !== null
        ? planData.trialDays
        : 7; // Default to 7 if not provided

    const insertQuery = `
      INSERT INTO subscription_plans (
        id,
        name,
        slug,
        description,
        custom_plan_name,
        price,  
        currency,
        billing_cycle,
        duration_value,
        duration_type,
        trial_days,
        features,
        is_active,
        sort_order,
        created_at,
        updated_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15
      )
      RETURNING 
        id,
        name,
        slug,
        description,
        custom_plan_name,
        price,
        currency,
        billing_cycle,
        duration_value,
        duration_type,
        trial_days,
        features,
        is_active,
        sort_order,
        created_at,
        updated_at
    `;

    const insertParams = [
      planData.name,
      planData.slug,
      planData.description ?? null,
      customPlanName, // Validated custom plan name
      planData.price.toString(),
      planData.currency || "USD",
      billingCycleValue,
      durationValue,
      durationType,
      trialDaysValue,
      featuresForDb,
      planData.isActive !== undefined ? planData.isActive : true,
      planData.sortOrder || 0,
      now.toISOString(),
      now.toISOString(),
    ];

    logger.info(
      "About to execute INSERT with name, slug, and customPlanName:",
      {
        name: planData.name,
        slug: planData.slug,
        nameInParams: insertParams[0],
        slugInParams: insertParams[1],
        customPlanName: planData.customPlanName,
        customPlanNameInParams: insertParams[3], // Index 3 is custom_plan_name
        allParams: insertParams,
      }
    );

    const insertResult = await connection.query(insertQuery, insertParams);

    // Map the result to camelCase for consistency
    const newPlan = insertResult.rows.map((row: any) => {
      const mapped = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        customPlanName: row.custom_plan_name,
        price: row.price,
        currency: row.currency,
        billingCycle: row.billing_cycle,
        durationValue:
          row.duration_value !== null && row.duration_value !== undefined
            ? Number(row.duration_value)
            : null,
        durationType: row.duration_type,
        trialDays:
          row.trial_days !== null && row.trial_days !== undefined
            ? Number(row.trial_days)
            : 7, // Default to 7 if null
        features: row.features,
        isActive: row.is_active,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      return mapped;
    });

    // Verify the insert was successful by querying the database directly
    const verifyQuery = `
      SELECT 
        id,
        name,
        slug,
        description,
        custom_plan_name,
        price,
        currency,
        billing_cycle,
        duration_value,
        duration_type,
        trial_days,
        features,
        is_active,
        sort_order,
        created_at,
        updated_at
      FROM subscription_plans
      WHERE id = $1
    `;
    const verifyResult = await connection.query(verifyQuery, [newPlan[0].id]);
    const verifyPlan = verifyResult.rows[0];

    const verifyLog = {
      name: verifyPlan?.name,
      slug: verifyPlan?.slug,
      custom_plan_name: verifyPlan?.custom_plan_name,
      duration_value: verifyPlan?.duration_value,
      duration_type: verifyPlan?.duration_type,
      allKeys: verifyPlan ? Object.keys(verifyPlan) : [],
      fullPlan: JSON.stringify(verifyPlan, null, 2),
    };
    logger.info("Verified created plan from database:", verifyLog);

    // Verify name and slug were saved correctly
    logger.info("Name and Slug verification:", {
      sentName: planData.name,
      savedName: verifyPlan?.name,
      nameMatches: planData.name === verifyPlan?.name,
      sentSlug: planData.slug,
      savedSlug: verifyPlan?.slug,
      slugMatches: planData.slug === verifyPlan?.slug,
    });

    // Check if customPlanName was saved correctly
    if (verifyPlan) {
      logger.info("CustomPlanName verification:", {
        sent: planData.customPlanName,
        saved: verifyPlan.custom_plan_name,
        match: planData.customPlanName === verifyPlan.custom_plan_name,
        sentType: typeof planData.customPlanName,
        savedType: typeof verifyPlan.custom_plan_name,
      });

      if (
        planData.customPlanName !== null &&
        planData.customPlanName !== undefined &&
        planData.customPlanName !== "" &&
        verifyPlan.custom_plan_name === null
      ) {
        console.error(
          "❌ CRITICAL: customPlanName was sent but saved as NULL!"
        );
        console.error("❌ Sent customPlanName:", planData.customPlanName);
        console.error(
          "❌ Database has custom_plan_name:",
          verifyPlan.custom_plan_name
        );
        logger.error("CRITICAL: customPlanName saved as NULL", {
          sent: planData.customPlanName,
          saved: verifyPlan.custom_plan_name,
        });
      }
    }

    // If the database has null values but we sent valid values, log an error
    if (
      verifyPlan &&
      (verifyPlan.duration_value === null || verifyPlan.duration_type === null)
    ) {
      console.error(
        "❌ CRITICAL: Database saved NULL values even though we sent valid values!"
      );
      console.error(
        "❌ Sent durationValue:",
        durationValue,
        "durationType:",
        durationType
      );
      console.error(
        "❌ Database has duration_value:",
        verifyPlan.duration_value,
        "duration_type:",
        verifyPlan.duration_type
      );
      logger.error("CRITICAL: Database saved NULL values", {
        sent: { durationValue, durationType },
        saved: {
          duration_value: verifyPlan.duration_value,
          duration_type: verifyPlan.duration_type,
        },
      });
    }

    logger.info(`Created subscription plan: ${planData.name}`);

    return res.status(201).json({
      success: true,
      message: "Subscription plan created successfully",
      data: newPlan[0],
    });
  } catch (error) {
    logger.error("Error creating subscription plan:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while creating subscription plan",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
