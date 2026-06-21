import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { clients, userOrganizations, notifications } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import crypto from "crypto";

export const assignLead = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id: leadId } = req.params;
    const { userId } = req.body;

    const [lead] = await database
      .select({ id: clients.id, name: clients.name, organizationId: clients.organizationId })
      .from(clients)
      .where(and(eq(clients.id, leadId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (!lead) {
      res.status(404).json({ success: false, message: "Lead not found" });
      return;
    }

    const now = new Date();

    if (userId === null || userId === undefined) {
      await database
        .update(clients)
        .set({ assignedTo: null, assignedAt: null, updatedAt: now })
        .where(eq(clients.id, leadId));

      res.status(200).json({ success: true, message: "Lead unassigned" });
      return;
    }

    // Validate user belongs to same org
    const [userOrg] = await database
      .select({ userId: userOrganizations.userId })
      .from(userOrganizations)
      .where(
        and(
          eq(userOrganizations.userId, userId),
          eq(userOrganizations.organizationId, organizationId),
          eq(userOrganizations.status, "active")
        )
      )
      .limit(1);

    if (!userOrg) {
      res.status(400).json({ success: false, message: "User not found in this organization" });
      return;
    }

    await database
      .update(clients)
      .set({ assignedTo: userId, assignedAt: now, updatedAt: now })
      .where(eq(clients.id, leadId));

    // Notify assigned user
    const assignerName = (req as any).user?.name ?? "Someone";
    database
      .insert(notifications)
      .values({
        id: crypto.randomUUID(),
        userId,
        organizationId,
        type: "lead_assigned",
        title: "New lead assigned to you",
        message: `${lead.name} was assigned to you by ${assignerName}`,
        read: false,
      })
      .catch(() => {});

    res.status(200).json({ success: true, message: `Lead assigned successfully` });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to assign lead" });
  }
};
