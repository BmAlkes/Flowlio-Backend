import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { leadRoutingRules } from "@/schema/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";

export const getRoutingRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const rules = await database
      .select()
      .from(leadRoutingRules)
      .where(eq(leadRoutingRules.organizationId, organizationId))
      .orderBy(asc(leadRoutingRules.priority));

    res.status(200).json({ success: true, data: rules });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch routing rules" });
  }
};

export const createRoutingRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { name, priority = 0, conditions, actions, isActive = true } = req.body;

    if (!name || !conditions || !actions) {
      res.status(400).json({ success: false, message: "name, conditions and actions are required" });
      return;
    }

    const [rule] = await database
      .insert(leadRoutingRules)
      .values({ organizationId, name, priority, conditions, actions, isActive })
      .returning();

    res.status(201).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to create routing rule" });
  }
};

export const updateRoutingRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { ruleId } = req.params;
    const { name, priority, conditions, actions, isActive } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name;
    if (priority !== undefined) updates.priority = priority;
    if (conditions !== undefined) updates.conditions = conditions;
    if (actions !== undefined) updates.actions = actions;
    if (isActive !== undefined) updates.isActive = isActive;

    const [updated] = await database
      .update(leadRoutingRules)
      .set(updates)
      .where(and(eq(leadRoutingRules.id, ruleId), eq(leadRoutingRules.organizationId, organizationId)))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, message: "Rule not found" });
      return;
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update routing rule" });
  }
};

export const deleteRoutingRule = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { ruleId } = req.params;

    const [deleted] = await database
      .delete(leadRoutingRules)
      .where(and(eq(leadRoutingRules.id, ruleId), eq(leadRoutingRules.organizationId, organizationId)))
      .returning({ id: leadRoutingRules.id });

    if (!deleted) {
      res.status(404).json({ success: false, message: "Rule not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Rule deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete routing rule" });
  }
};

export const reorderRoutingRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { ruleIds } = req.body as { ruleIds: string[] };
    if (!Array.isArray(ruleIds)) {
      res.status(400).json({ success: false, message: "ruleIds array is required" });
      return;
    }

    const now = new Date();
    await Promise.all(
      ruleIds.map((id, index) =>
        database
          .update(leadRoutingRules)
          .set({ priority: index, updatedAt: now })
          .where(and(eq(leadRoutingRules.id, id), eq(leadRoutingRules.organizationId, organizationId)))
      )
    );

    res.status(200).json({ success: true, message: "Rules reordered" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to reorder rules" });
  }
};
