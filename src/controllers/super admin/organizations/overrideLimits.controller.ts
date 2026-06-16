import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { organizations, aiTokenLimits } from "@/schema/schema";
import { eq, and, isNull } from "drizzle-orm";

/**
 * Override individual limits for an organization without changing its plan.
 * Null values clear the override (org falls back to plan limit).
 * PUT /api/superadmin/organizations/:orgId/override-limits
 *
 * Body (all optional, send only what you want to change):
 * {
 *   maxLeads: number | null,
 *   maxClients: number | null,
 *   maxWebhooks: number | null,
 *   maxTasks: number | null,
 *   maxInvoices: number | null,
 *   maxProposals: number | null,
 *   aiTokenLimit: number | null,   // also updates ai_token_limits table
 * }
 */
export const overrideLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    const { orgId } = req.params;
    const {
      maxLeads,
      maxClients,
      maxWebhooks,
      maxTasks,
      maxInvoices,
      maxProposals,
      aiTokenLimit,
    } = req.body;

    if (!orgId) {
      res.status(400).json({ success: false, message: "orgId is required" });
      return;
    }

    const [org] = await database
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      res.status(404).json({ success: false, message: "Organization not found" });
      return;
    }

    const now = new Date();

    // Build update payload — only include fields explicitly sent in the body
    const updates: Record<string, any> = { updatedAt: now };
    if ("maxLeads" in req.body) updates.overrideMaxLeads = maxLeads ?? null;
    if ("maxClients" in req.body) updates.overrideMaxClients = maxClients ?? null;
    if ("maxWebhooks" in req.body) updates.overrideMaxWebhooks = maxWebhooks ?? null;
    if ("maxTasks" in req.body) updates.overrideMaxTasks = maxTasks ?? null;
    if ("maxInvoices" in req.body) updates.overrideMaxInvoices = maxInvoices ?? null;
    if ("maxProposals" in req.body) updates.overrideMaxProposals = maxProposals ?? null;
    if ("aiTokenLimit" in req.body) updates.overrideAiTokenLimit = aiTokenLimit ?? null;

    await database.update(organizations).set(updates).where(eq(organizations.id, orgId));

    // If aiTokenLimit override was provided, sync it to ai_token_limits table
    if ("aiTokenLimit" in req.body && aiTokenLimit !== null && aiTokenLimit !== undefined) {
      const [existingLimit] = await database
        .select({ id: aiTokenLimits.id })
        .from(aiTokenLimits)
        .where(
          and(
            eq(aiTokenLimits.organizationId, orgId),
            isNull(aiTokenLimits.userId),
            isNull(aiTokenLimits.feature)
          )
        )
        .limit(1);

      if (existingLimit) {
        await database
          .update(aiTokenLimits)
          .set({ tokenLimit: aiTokenLimit, updatedAt: now })
          .where(eq(aiTokenLimits.id, existingLimit.id));
      }
    }

    logger.info(`Limit overrides updated for org ${org.name} (${orgId}):`, updates);

    res.status(200).json({
      success: true,
      message: `Limits updated for "${org.name}"`,
      data: updates,
    });
  } catch (error: any) {
    logger.error("Error overriding org limits:", error);
    res.status(500).json({ success: false, message: "Failed to update limits" });
  }
};
