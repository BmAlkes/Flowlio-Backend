import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { leadTags, leadTagAssignments, clients } from "@/schema/schema";
import { eq, and, sql } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";

export const getTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const tags = await database
      .select({
        id: leadTags.id,
        name: leadTags.name,
        color: leadTags.color,
        leadCount: sql<number>`(SELECT count(*) FROM lead_tag_assignments WHERE tag_id = ${leadTags.id})`,
      })
      .from(leadTags)
      .where(eq(leadTags.organizationId, organizationId));

    res.status(200).json({ success: true, data: tags });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch tags" });
  }
};

export const createTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { name, color = "#6B7280" } = req.body;
    if (!name) {
      res.status(400).json({ success: false, message: "name is required" });
      return;
    }

    const [tag] = await database
      .insert(leadTags)
      .values({ organizationId, name, color })
      .returning();

    res.status(201).json({ success: true, data: tag });
  } catch (error: any) {
    if (error?.code === "23505") {
      res.status(409).json({ success: false, message: "Tag already exists" });
      return;
    }
    res.status(500).json({ success: false, message: "Failed to create tag" });
  }
};

export const updateTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { tagId } = req.params;
    const { name, color } = req.body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (color !== undefined) updates.color = color;

    const [updated] = await database
      .update(leadTags)
      .set(updates)
      .where(and(eq(leadTags.id, tagId), eq(leadTags.organizationId, organizationId)))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, message: "Tag not found" });
      return;
    }

    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to update tag" });
  }
};

export const deleteTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { tagId } = req.params;

    const [deleted] = await database
      .delete(leadTags)
      .where(and(eq(leadTags.id, tagId), eq(leadTags.organizationId, organizationId)))
      .returning({ id: leadTags.id });

    if (!deleted) {
      res.status(404).json({ success: false, message: "Tag not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Tag deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to delete tag" });
  }
};

export const setLeadTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { leadId } = req.params;
    const { tagIds } = req.body as { tagIds: string[] };

    if (!Array.isArray(tagIds)) {
      res.status(400).json({ success: false, message: "tagIds array is required" });
      return;
    }

    // Verify lead belongs to org
    const [lead] = await database
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, leadId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    // Replace all tags (delete existing, insert new)
    await database.delete(leadTagAssignments).where(eq(leadTagAssignments.leadId, leadId));

    if (tagIds.length > 0) {
      await database.insert(leadTagAssignments).values(
        tagIds.map((tagId) => ({ leadId, tagId }))
      );
    }

    res.status(200).json({ success: true, message: "Tags updated" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to set lead tags" });
  }
};
