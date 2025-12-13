import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { PlanFeature } from "./createplans.controller";

interface UpsertPlanRequest {
  id?: string; // Optional: if provided, find plan by ID (allows slug/name changes)
  name: string;
  slug: string;
  description?: string;
  customPlanName?: string; // Optional custom display name (different from the base plan name)
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

export const upsertPlan = async (req: Request, res: Response) => {
  try {
    const planData: UpsertPlanRequest = req.body;
    const { slug, id } = planData;

    logger.info("Received plan data:", {
      id: planData.id,
      idType: typeof planData.id,
      idUndefined: planData.id === undefined,
      idNull: planData.id === null,
      name: planData.name,
      slug: planData.slug,
      customPlanName: planData.customPlanName,
      customPlanNameType: typeof planData.customPlanName,
      customPlanNameUndefined: planData.customPlanName === undefined,
      customPlanNameNull: planData.customPlanName === null,
      durationValue: planData.durationValue,
      durationType: planData.durationType,
      fullBody: JSON.stringify(req.body, null, 2),
    });

    let existingPlan = null;

    // If ID is provided, find plan by ID (allows slug/name changes)
    if (id) {
      logger.info("🔍 Checking for existing plan by ID:", {
        id: id,
        idType: typeof id,
        idLength: id?.length,
      });
      try {
        const checkByIdQuery = `
          SELECT id, name, slug
          FROM subscription_plans
          WHERE id = $1
          LIMIT 1
        `;
        const existingPlanResult = await connection.query(checkByIdQuery, [id]);
        existingPlan = existingPlanResult.rows[0] || null;

        logger.info("✅ Existing plan check (by ID):", {
          id: id,
          found: !!existingPlan,
          existingPlanId: existingPlan?.id,
          existingPlanName: existingPlan?.name,
          existingPlanSlug: existingPlan?.slug,
          rowCount: existingPlanResult.rows.length,
        });
      } catch (checkError: any) {
        logger.error("❌ Error checking for existing plan by ID:", {
          error: checkError?.message,
          id: id,
          code: checkError?.code,
          stack: checkError?.stack,
        });
      }
    } else {
      logger.warn("⚠️ No ID provided in request, will check by slug");
    }

    // If not found by ID, check by slug (backward compatibility)
    if (!existingPlan) {
      logger.info("🔍 Plan not found by ID, checking by slug:", {
        slug: slug,
        hadId: !!id,
      });
      try {
        // First, list all existing plans for debugging
        const listAllSlugsQuery = `SELECT slug, name, id FROM subscription_plans ORDER BY slug`;
        const allPlansResult = await connection.query(listAllSlugsQuery);
        logger.info("📋 All existing plans in database:", {
          count: allPlansResult.rows.length,
          plans: allPlansResult.rows.map((r: any) => ({
            slug: r.slug,
            name: r.name,
            id: r.id,
          })),
          searchingFor: slug,
        });

        // Use exact match first (most common case)
        const checkExistingQuery = `
          SELECT id, name, slug
          FROM subscription_plans
          WHERE slug = $1
          LIMIT 1
        `;

        const existingPlanResult = await connection.query(checkExistingQuery, [
          slug,
        ]);
        existingPlan = existingPlanResult.rows[0] || null;

        logger.info("✅ Existing plan check (by slug, exact match):", {
          slug: slug,
          found: !!existingPlan,
          existingPlanId: existingPlan?.id,
          existingPlanName: existingPlan?.name,
          existingPlanSlug: existingPlan?.slug,
          rowCount: existingPlanResult.rows.length,
        });

        // If not found with exact match, try case-insensitive search
        if (!existingPlan) {
          const normalizedSlug = slug.trim().toLowerCase();
          const caseInsensitiveQuery = `
            SELECT id, name, slug
            FROM subscription_plans
            WHERE LOWER(TRIM(slug)) = $1
            LIMIT 1
          `;
          const caseInsensitiveResult = await connection.query(
            caseInsensitiveQuery,
            [normalizedSlug]
          );
          existingPlan = caseInsensitiveResult.rows[0] || null;

          if (existingPlan) {
            logger.info("Found plan with case-insensitive search:", {
              foundSlug: existingPlan.slug,
              searchedSlug: slug,
              normalizedSlug: normalizedSlug,
            });
          } else {
            logger.warn("⚠️ Plan not found by slug - will attempt INSERT", {
              searchedSlug: slug,
              normalizedSlug: normalizedSlug,
              hadId: !!id,
            });
          }
        }
      } catch (checkError: any) {
        logger.error("Error checking for existing plan by slug:", {
          error: checkError?.message,
          slug: slug,
          stack: checkError?.stack,
        });
        // Continue - if check fails, we'll try to insert (which will fail if it exists)
      }
    }

    // If we found a plan by slug but didn't have an ID, use the found plan's ID
    if (existingPlan && !id) {
      logger.info(
        "Found plan by slug but no ID was provided - using found plan's ID for update:",
        {
          foundPlanId: existingPlan.id,
          foundPlanSlug: existingPlan.slug,
          foundPlanName: existingPlan.name,
        }
      );
      // The existingPlan already has the ID, so we can proceed with the update
    }

    // Final check before proceeding
    logger.info("🎯 Final plan lookup result:", {
      existingPlanFound: !!existingPlan,
      existingPlanId: existingPlan?.id,
      existingPlanName: existingPlan?.name,
      existingPlanSlug: existingPlan?.slug,
      willUpdate: !!existingPlan,
      willInsert: !existingPlan,
    });

    let result;
    let isUpdate = false;

    if (existingPlan) {
      // Update existing plan
      isUpdate = true;

      // CRITICAL: Slug should NEVER change - always use the existing plan's slug
      // Slugs are fixed identifiers: "basic", "standard", "premium"
      // Users can only change name, description, price, features, etc.

      // Safety check: ensure slug exists
      if (!existingPlan.slug) {
        logger.error("Cannot update plan: existingPlan.slug is missing", {
          existingPlan,
          requestSlug: slug,
          planId: existingPlan.id,
        });
        return res.status(400).json({
          success: false,
          message:
            "Cannot update plan: slug identifier is missing from existing plan",
          error:
            process.env.NODE_ENV === "development"
              ? `Existing plan found but slug is missing. Plan ID: ${existingPlan.id}`
              : undefined,
        });
      }

      const fixedSlug = existingPlan.slug; // Always use the existing slug, never the request slug

      // Validate that the requested slug matches the existing slug (if provided)
      if (planData.slug && planData.slug !== existingPlan.slug) {
        logger.warn("Slug change attempted but slugs are immutable:", {
          existingSlug: existingPlan.slug,
          requestedSlug: planData.slug,
          planId: existingPlan.id,
        });
        // Don't throw error, just use the existing slug instead
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
          logger.info("CustomPlanName validation (UPDATE):", {
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
        logger.info("CustomPlanName validation (UPDATE):", {
          received: planData.customPlanName,
          final: null,
          reason: "undefined or null",
        });
      }

      // Prepare update data with explicit handling of duration fields
      // IMPORTANT: Use the validated customPlanName variable, not planData.customPlanName
      const updateData: any = {
        name: planData.name,
        slug: fixedSlug, // Always use the existing slug, never allow changes
        description: planData.description ?? null,
        customPlanName: customPlanName, // Use validated customPlanName (not planData.customPlanName)
        price: planData.price.toString(),
        currency: planData.currency || "USD",
        billingCycle:
          planData.billingCycle &&
          (planData.billingCycle === "days" ||
            planData.billingCycle === "monthly" ||
            planData.billingCycle === "yearly")
            ? planData.billingCycle
            : "monthly",
        features: planData.features || null,
        isActive: planData.isActive !== undefined ? planData.isActive : true,
        sortOrder: planData.sortOrder || 0,
        updatedAt: new Date(),
      };

      logger.info("UPDATE - Preparing to update plan:", {
        existingPlanName: existingPlan.name,
        newName: updateData.name,
        slug: updateData.slug,
        nameChanged: existingPlan.name !== updateData.name,
      });

      // Validate durationValue - OPTIONAL for updates (use existing value if not provided)
      let durationValue: number | null = null;
      if (
        planData.durationValue !== undefined &&
        planData.durationValue !== null
      ) {
        if (typeof planData.durationValue === "number") {
          if (!isNaN(planData.durationValue) && planData.durationValue >= 0) {
            durationValue = planData.durationValue;
          } else {
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
        // For updates, if durationValue is not provided, fetch existing value from database
        logger.info(
          "durationValue not provided in update, fetching from database"
        );
        try {
          const fetchDurationQuery = `
            SELECT duration_value, duration_type
            FROM subscription_plans
            WHERE slug = $1
            LIMIT 1
          `;
          const durationResult = await connection.query(fetchDurationQuery, [
            existingPlan.slug,
          ]);
          if (durationResult.rows[0]) {
            durationValue =
              durationResult.rows[0].duration_value !== null &&
              durationResult.rows[0].duration_value !== undefined
                ? Number(durationResult.rows[0].duration_value)
                : null;
            logger.info("Fetched existing durationValue from database:", {
              durationValue,
            });
          }
        } catch (fetchError: any) {
          logger.error("Error fetching existing durationValue:", fetchError);
          // Continue with null - will be handled by durationType validation
        }
      }
      updateData.durationValue = durationValue;

      // Validate durationType - OPTIONAL for updates (use existing value if not provided)
      let durationType: "days" | "monthly" | "yearly" | null = null;
      if (
        planData.durationType !== undefined &&
        planData.durationType !== null
      ) {
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
            logger.error("Invalid durationType value:", planData.durationType);
            return res.status(400).json({
              success: false,
              message:
                "Invalid durationType: must be 'days', 'monthly', or 'yearly'",
              receivedValue: planData.durationType,
            });
          }
        } else {
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
        // For updates, if durationType is not provided, fetch existing value from database
        logger.info(
          "durationType not provided in update, fetching from database"
        );
        try {
          const fetchDurationQuery = `
            SELECT duration_value, duration_type
            FROM subscription_plans
            WHERE slug = $1
            LIMIT 1
          `;
          const durationResult = await connection.query(fetchDurationQuery, [
            existingPlan.slug,
          ]);
          if (durationResult.rows[0]) {
            durationType = durationResult.rows[0].duration_type;
            logger.info("Fetched existing durationType from database:", {
              durationType,
            });
          }
        } catch (fetchError: any) {
          logger.error("Error fetching existing durationType:", fetchError);
          // Continue with null - database might allow null values
        }
      }
      updateData.durationType = durationType;

      const updateDataLog = {
        durationValue: updateData.durationValue,
        durationType: updateData.durationType,
        fullUpdateData: JSON.stringify(updateData, null, 2),
      };
      logger.info("Update data prepared:", updateDataLog);

      // Use connection pool directly for reliable parameterized queries
      // Handle features - convert to JSON string if exists, otherwise null
      const featuresForDb = updateData.features
        ? JSON.stringify(updateData.features)
        : null;

      // Since slugs are fixed and immutable, we can always use slug for updates
      // Slugs are stable identifiers: "basic", "standard", "premium"
      // We use the existing plan's slug (which never changes) for the WHERE clause
      const updateIdentifier = existingPlan.slug; // Always use the existing slug (it's immutable)

      // Safety check: slug must exist
      if (!existingPlan.slug) {
        logger.error("Cannot update plan: existingPlan.slug is missing", {
          existingPlan,
          requestSlug: slug,
        });
        return res.status(400).json({
          success: false,
          message: "Cannot update plan: slug identifier is missing",
        });
      }

      // Always use slug for WHERE clause since slugs are immutable identifiers
      const updateQuery = `
        UPDATE subscription_plans
        SET 
          name = $1,
          slug = $2,
          description = $3,
          custom_plan_name = $4,
          price = $5,
          currency = $6,
          billing_cycle = $7,
          duration_value = $8,
          duration_type = $9,
          trial_days = $10,
          features = $11,
          is_active = $12,
          sort_order = $13,
          updated_at = $14
        WHERE slug = $15
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

      logger.info("UPDATE - Preparing to update plan:", {
        requestId: id,
        existingPlanId: existingPlan.id,
        existingPlanName: existingPlan.name,
        existingPlanSlug: existingPlan.slug,
        newName: updateData.name,
        fixedSlug: updateData.slug, // Slug never changes, always matches existingPlan.slug
        nameChanged: existingPlan.name !== updateData.name,
        updateIdentifier: updateIdentifier,
        updateDataName: updateData.name,
        planDataName: planData.name,
      });

      // Log the exact values being sent to the database
      const trialDaysValue =
        planData.trialDays !== undefined && planData.trialDays !== null
          ? planData.trialDays
          : 7; // Default to 7 if not provided

      const updateParamsArray = [
        updateData.name,
        updateData.slug,
        updateData.description ?? null,
        customPlanName, // Use validated customPlanName directly (not updateData.customPlanName)
        updateData.price,
        updateData.currency,
        updateData.billingCycle,
        updateData.durationValue ?? null,
        updateData.durationType ?? null,
        trialDaysValue,
        featuresForDb, // Pass JSON string directly, pg will handle conversion
        updateData.isActive,
        updateData.sortOrder,
        updateData.updatedAt.toISOString(), // Convert Date to ISO string
        updateIdentifier, // Use slug (always)
      ];

      logger.info("UPDATE - About to execute with customPlanName:", {
        receivedFromRequest: planData.customPlanName,
        validatedCustomPlanName: customPlanName,
        customPlanNameInUpdateData: updateData.customPlanName,
        customPlanNameInParams: updateParamsArray[3], // Index 3 is custom_plan_name
        willBeSaved: customPlanName,
      });

      // Log the exact parameter values being sent
      logger.info("UPDATE - Parameter values being sent to database:", {
        param1_name: updateParamsArray[0],
        param2_slug: updateParamsArray[1],
        param4_customPlanName: updateParamsArray[3],
        param13_identifier: updateParamsArray[13],
        allParams: updateParamsArray.map((p, i) => ({
          index: i + 1,
          value:
            i === 8
              ? typeof p === "string"
                ? p.substring(0, 50) + "..."
                : p
              : p, // Truncate features JSON
          type: typeof p,
        })),
      });

      let updateResult;
      try {
        logger.info("Executing UPDATE query:", {
          query: updateQuery.substring(0, 100) + "...",
          paramsCount: updateParamsArray.length,
          updateIdentifier: updateIdentifier,
          whereClause: `WHERE slug = $13`,
        });
        updateResult = await connection.query(updateQuery, updateParamsArray);
        logger.info("UPDATE query executed successfully:", {
          rowCount: updateResult.rowCount,
          rowsReturned: updateResult.rows?.length || 0,
        });
      } catch (queryError: any) {
        logger.error("Error executing UPDATE query:", {
          error: queryError?.message,
          code: queryError?.code,
          detail: queryError?.detail,
          constraint: queryError?.constraint,
          stack: queryError?.stack,
          updateIdentifier: updateIdentifier,
          slug: existingPlan.slug,
        });

        // Check for unique constraint violation on slug
        if (
          queryError?.code === "23505" ||
          (queryError?.constraint && queryError.constraint.includes("slug"))
        ) {
          return res.status(400).json({
            success: false,
            message:
              "A plan with this slug already exists. Please choose a different slug.",
            error:
              process.env.NODE_ENV === "development"
                ? `Slug '${updateData.slug}' already exists`
                : undefined,
          });
        }

        throw queryError; // Re-throw to be caught by outer catch
      }

      if (!updateResult.rows || updateResult.rows.length === 0) {
        logger.error("UPDATE query returned no rows", {
          rowCount: updateResult.rowCount,
          slug: existingPlan.slug,
          name: updateData.name,
          updateIdentifier: updateIdentifier,
          existingPlanId: existingPlan.id,
          requestId: id,
        });
        return res.status(404).json({
          success: false,
          message:
            "Failed to update subscription plan: Plan not found or no changes applied",
          error:
            process.env.NODE_ENV === "development"
              ? `Update query returned no rows. Slug: ${updateIdentifier}`
              : undefined,
        });
      }

      const updateResultLog = {
        rowCount: updateResult.rows.length,
        firstRow: updateResult.rows[0]
          ? {
              id: updateResult.rows[0].id,
              name: updateResult.rows[0].name,
              slug: updateResult.rows[0].slug,
              duration_value: updateResult.rows[0].duration_value,
              duration_type: updateResult.rows[0].duration_type,
              allKeys: Object.keys(updateResult.rows[0]),
              fullRow: JSON.stringify(updateResult.rows[0], null, 2),
            }
          : null,
      };
      logger.info("Update query result (raw from DB):", updateResultLog);
      logger.info("UPDATE - Name after update:", {
        requestedName: updateData.name,
        returnedName: updateResult.rows[0]?.name,
        match: updateData.name === updateResult.rows[0]?.name,
      });

      // Map the result to camelCase for consistency

      result = updateResult.rows.map((row: any) => {
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

      const mappedResultLog = {
        durationValue: result[0]?.durationValue,
        durationType: result[0]?.durationType,
        allKeys: Object.keys(result[0] || {}),
        fullResult: JSON.stringify(result[0], null, 2),
      };
      logger.info(`Updated subscription plan: ${planData.name}`);
      logger.info("Updated plan data (mapped):", mappedResultLog);

      // Verify the update was successful by querying the database directly
      // Always verify by slug since slugs are immutable
      const verifyIdentifier = existingPlan.slug; // Slug never changes

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
        WHERE slug = $1
      `;
      const verifyResult = await connection.query(verifyQuery, [
        verifyIdentifier,
      ]);
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
      logger.info("Verified updated plan from database:", verifyLog);
      logger.info("UPDATE - Verification check:", {
        requestedName: updateData.name,
        verifiedName: verifyPlan?.name,
        nameMatches: updateData.name === verifyPlan?.name,
        requestedCustomPlanName: customPlanName, // Use validated value
        verifiedCustomPlanName: verifyPlan?.custom_plan_name,
        customPlanNameMatches: customPlanName === verifyPlan?.custom_plan_name,
        updateDataCustomPlanName: updateData.customPlanName, // For comparison
      });

      // Check if customPlanName was saved correctly
      if (
        customPlanName !== null &&
        customPlanName !== undefined &&
        customPlanName !== "" &&
        verifyPlan?.custom_plan_name === null
      ) {
        logger.error("CRITICAL: customPlanName saved as NULL in UPDATE", {
          sent: customPlanName,
          saved: verifyPlan?.custom_plan_name,
        });
      }
    } else {
      // Create new plan
      logger.info("No existing plan found - creating new plan", {
        slug: slug,
        name: planData.name,
      });

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
        logger.error("durationValue is REQUIRED but is undefined or null");
        return res.status(400).json({
          success: false,
          message: "durationValue is required and cannot be null",
          receivedValue: planData.durationValue,
        });
      }

      // Validate durationType - REQUIRED FIELD
      let durationType: "days" | "monthly" | "yearly" | null = null;
      if (
        planData.durationType !== undefined &&
        planData.durationType !== null
      ) {
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
            logger.error("Invalid durationType value:", planData.durationType);
            return res.status(400).json({
              success: false,
              message:
                "Invalid durationType: must be 'days', 'monthly', or 'yearly'",
              receivedValue: planData.durationType,
            });
          }
        } else {
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
          logger.info("CustomPlanName validation (INSERT):", {
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
        logger.info("CustomPlanName validation (INSERT):", {
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
      // Handle features - convert to JSON string if exists, otherwise null
      const featuresForDb = planData.features
        ? JSON.stringify(planData.features)
        : null;
      const now = new Date();
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

      const trialDaysValue =
        planData.trialDays !== undefined && planData.trialDays !== null
          ? planData.trialDays
          : 7; // Default to 7 if not provided

      const insertParamsArray = [
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
        featuresForDb, // Pass JSON string directly, pg will handle conversion
        planData.isActive !== undefined ? planData.isActive : true,
        planData.sortOrder || 0,
        now.toISOString(), // Convert Date to ISO string
        now.toISOString(), // Convert Date to ISO string
      ];

      logger.info("About to execute INSERT query with params:", {
        name: planData.name,
        slug: planData.slug,
        customPlanName: planData.customPlanName,
        customPlanNameInParams: insertParamsArray[3],
        allParams: insertParamsArray,
      });

      let insertResult;
      try {
        insertResult = await connection.query(insertQuery, insertParamsArray);
      } catch (dbError: any) {
        logger.error("Database error during INSERT:", {
          message: dbError?.message,
          code: dbError?.code,
          detail: dbError?.detail,
          constraint: dbError?.constraint,
          slug: slug,
          name: planData.name,
        });

        // Check for unique constraint violation (PostgreSQL error code 23505)
        if (
          dbError?.code === "23505" ||
          dbError?.message?.toLowerCase().includes("unique") ||
          dbError?.message?.toLowerCase().includes("duplicate") ||
          dbError?.constraint?.includes("slug")
        ) {
          // Plan exists but check failed - retry as UPDATE
          logger.warn(
            "INSERT failed due to unique constraint - retrying as UPDATE",
            {
              slug: slug,
              errorCode: dbError?.code,
              constraint: dbError?.constraint,
            }
          );

          // Re-check for existing plan and update instead
          try {
            const retryCheckQuery = `
              SELECT id, name, slug
              FROM subscription_plans
              WHERE slug = $1
              LIMIT 1
            `;
            const retryCheckResult = await connection.query(retryCheckQuery, [
              slug,
            ]);
            const retryExistingPlan = retryCheckResult.rows[0] || null;

            if (retryExistingPlan) {
              logger.info(
                "Found existing plan on retry - plan exists but initial check failed",
                {
                  planId: retryExistingPlan.id,
                  existingName: retryExistingPlan.name,
                  newName: planData.name,
                  slug: slug,
                }
              );

              // Return a clear error message asking user to retry
              // The next request should find the plan correctly
              return res.status(409).json({
                success: false,
                message:
                  "A plan with this slug already exists. The system will update it. Please try again - the update should work on the next attempt.",
                error:
                  process.env.NODE_ENV === "development"
                    ? `Slug '${slug}' already exists. Found plan: ${retryExistingPlan.name}. The initial check failed to find it, but it exists in the database.`
                    : undefined,
                existingPlan: {
                  id: retryExistingPlan.id,
                  name: retryExistingPlan.name,
                  slug: retryExistingPlan.slug,
                },
                suggestion:
                  "Please refresh the page and try updating again. The system should detect the existing plan correctly.",
              });
            }
          } catch (retryError: any) {
            logger.error("Error during retry check:", retryError);
          }

          return res.status(400).json({
            success: false,
            message:
              "A plan with this slug already exists. Please update the existing plan instead.",
            error:
              process.env.NODE_ENV === "development"
                ? `Slug '${slug}' already exists. Error: ${dbError.message}`
                : undefined,
          });
        }

        throw dbError; // Re-throw to be caught by outer catch
      }

      if (!insertResult.rows || insertResult.rows.length === 0) {
        logger.error("INSERT query returned no rows", {
          rowCount: insertResult.rowCount,
          slug: slug,
        });
        return res.status(500).json({
          success: false,
          message: "Failed to create subscription plan: No data returned",
        });
      }

      const insertResultLog = {
        rowCount: insertResult.rows.length,
        firstRow: insertResult.rows[0]
          ? {
              id: insertResult.rows[0].id,
              name: insertResult.rows[0].name,
              custom_plan_name: insertResult.rows[0].custom_plan_name,
              duration_value: insertResult.rows[0].duration_value,
              duration_type: insertResult.rows[0].duration_type,
              allKeys: Object.keys(insertResult.rows[0]),
              fullRow: JSON.stringify(insertResult.rows[0], null, 2),
            }
          : null,
      };
      logger.info("Insert query result (raw from DB):", insertResultLog);

      // Map the result to camelCase for consistency
      result = insertResult.rows.map((row: any) => ({
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
      }));

      // Verify the creation was successful by querying the database directly
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
        WHERE slug = $1
      `;
      const verifyResult = await connection.query(verifyQuery, [slug]);
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
      logger.info("Verified created plan from database (INSERT):", verifyLog);

      // Check if customPlanName was saved correctly
      logger.info("CustomPlanName verification (INSERT):", {
        receivedFromRequest: planData.customPlanName,
        validatedCustomPlanName: customPlanName,
        saved: verifyPlan?.custom_plan_name,
        match: customPlanName === verifyPlan?.custom_plan_name,
        sentType: typeof customPlanName,
        savedType: typeof verifyPlan?.custom_plan_name,
      });

      if (
        customPlanName !== null &&
        customPlanName !== undefined &&
        customPlanName !== "" &&
        verifyPlan?.custom_plan_name === null
      ) {
        console.error(
          "❌ CRITICAL: customPlanName was sent but saved as NULL in INSERT!"
        );
        console.error("❌ Sent customPlanName:", customPlanName);
        console.error(
          "❌ Database has custom_plan_name:",
          verifyPlan?.custom_plan_name
        );
        logger.error("CRITICAL: customPlanName saved as NULL in INSERT", {
          sent: customPlanName,
          saved: verifyPlan?.custom_plan_name,
        });
      }

      // If the database has null values but we sent valid values, log an error
      if (
        verifyPlan &&
        (verifyPlan.duration_value === null ||
          verifyPlan.duration_type === null)
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
    }

    // Ensure the response includes durationValue and durationType
    // Explicitly map all fields to ensure nothing is missing
    const responseData = result[0]
      ? {
          id: result[0].id,
          name: result[0].name,
          slug: result[0].slug,
          description: result[0].description,
          customPlanName: result[0].customPlanName ?? null,
          price: result[0].price,
          currency: result[0].currency,
          billingCycle: result[0].billingCycle,
          durationValue: result[0].durationValue ?? null,
          durationType: result[0].durationType ?? null,
          features: result[0].features,
          isActive: result[0].isActive,
          sortOrder: result[0].sortOrder,
          createdAt: result[0].createdAt,
          updatedAt: result[0].updatedAt,
        }
      : null;

    const responseLog = {
      durationValue: responseData?.durationValue,
      durationType: responseData?.durationType,
      allKeys: responseData ? Object.keys(responseData) : [],
      fullResponse: JSON.stringify(responseData, null, 2),
    };
    logger.info("Sending response with data:", responseLog);

    return res.status(200).json({
      success: true,
      message: `Subscription plan ${
        isUpdate ? "updated" : "created"
      } successfully`,
      data: responseData,
      isUpdate,
    });
  } catch (error) {
    logger.error("Error upserting subscription plan:", error);
    if (error instanceof Error) {
      logger.error("Error message:", error.message);
      logger.error("Error stack:", error.stack);
      logger.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
        requestBody: JSON.stringify(req.body, null, 2),
      });

      // Check for unique constraint violation
      if (
        error.message.includes("unique") ||
        error.message.includes("duplicate")
      ) {
        return res.status(400).json({
          success: false,
          message: "A plan with this slug already exists",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }

      // Check for database connection errors
      if (
        error.message.includes("connection") ||
        error.message.includes("timeout")
      ) {
        return res.status(503).json({
          success: false,
          message: "Database connection error. Please try again later.",
          error:
            process.env.NODE_ENV === "development" ? error.message : undefined,
        });
      }
    }
    return res.status(500).json({
      success: false,
      message: "Internal server error while upserting subscription plan",
      error:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? `${error.message}\n\nStack: ${error.stack}`
            : String(error)
          : undefined,
    });
  }
};
