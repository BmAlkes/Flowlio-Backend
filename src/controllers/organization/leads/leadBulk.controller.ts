import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { database } from "@/configs/connection.config";
import { clients, leadTagAssignments } from "@/schema/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

// ── POST /api/leads/bulk ────────────────────────────────────────────────────

export const bulkLeadAction = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { leadIds, action, payload } = req.body;

    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      res.status(400).json({ success: false, message: "leadIds array is required" });
      return;
    }

    if (leadIds.length > 100) {
      res.status(400).json({ success: false, message: "Maximum 100 leads per operation" });
      return;
    }

    const now = new Date();

    switch (action) {
      case "assign":
        await database
          .update(clients)
          .set({ assignedTo: payload?.userId ?? null, assignedAt: payload?.userId ? now : null, updatedAt: now })
          .where(and(inArray(clients.id, leadIds), eq(clients.organizationId, organizationId)));
        break;

      case "set_status":
        await database
          .update(clients)
          .set({ status: payload?.status, updatedAt: now })
          .where(and(inArray(clients.id, leadIds), eq(clients.organizationId, organizationId)));
        break;

      case "set_temperature":
        await database
          .update(clients)
          .set({ leadTemperature: payload?.temperature, updatedAt: now })
          .where(and(inArray(clients.id, leadIds), eq(clients.organizationId, organizationId)));
        break;

      case "add_tags":
        if (Array.isArray(payload?.tagIds)) {
          const values = leadIds.flatMap((leadId: string) =>
            payload.tagIds.map((tagId: string) => ({ leadId, tagId }))
          );
          if (values.length > 0) {
            await database.insert(leadTagAssignments).values(values).onConflictDoNothing();
          }
        }
        break;

      case "delete":
        await database
          .delete(clients)
          .where(and(inArray(clients.id, leadIds), eq(clients.organizationId, organizationId)));
        break;

      default:
        res.status(400).json({ success: false, message: `Unknown action: ${action}` });
        return;
    }

    res.status(200).json({ success: true, affected: leadIds.length });
  } catch (error) {
    res.status(500).json({ success: false, message: "Bulk operation failed" });
  }
};

// ── POST /api/leads/check-duplicate ─────────────────────────────────────────

export const checkDuplicate = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { email, phone } = req.body;

    if (!email && !phone) {
      res.status(400).json({ success: false, message: "email or phone is required" });
      return;
    }

    let existing: any = null;

    if (email && !email.includes("@noemail.invalid")) {
      [existing] = await database
        .select({ id: clients.id, name: clients.name, email: clients.email })
        .from(clients)
        .where(
          and(
            eq(clients.organizationId, organizationId),
            eq(clients.email, email),
            eq(clients.clientType, "lead")
          )
        )
        .limit(1);
    }

    if (!existing && phone) {
      [existing] = await database
        .select({ id: clients.id, name: clients.name, email: clients.email })
        .from(clients)
        .where(
          and(
            eq(clients.organizationId, organizationId),
            sql`${clients.phone} = ${phone}`,
            eq(clients.clientType, "lead")
          )
        )
        .limit(1);
    }

    res.status(200).json({
      success: true,
      isDuplicate: !!existing,
      existingLead: existing ?? undefined,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Duplicate check failed" });
  }
};

// ── GET /api/leads/export ───────────────────────────────────────────────────

export const exportLeads = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const result = await connection.query({
      text: `
        SELECT
          c.name, c.email, c.phone, c.status, c.lead_temperature AS temperature,
          c.webhook_name AS source, c.lead_value AS "leadValue",
          c.follow_up_at AS "followUpDate", c.created_at AS "createdAt",
          c.business_industry AS industry, c.address,
          u.name AS "assignedTo",
          c.custom_fields AS "customFields"
        FROM clients c
        LEFT JOIN users u ON u.id = c.assigned_to
        WHERE c.organization_id = $1 AND c.type = 'lead'
        ORDER BY c.created_at DESC
        LIMIT 10000
      `,
      values: [organizationId],
    });

    const rows = result.rows;

    // Collect all custom field keys
    const cfKeys = new Set<string>();
    for (const row of rows) {
      if (row.customFields && typeof row.customFields === "object") {
        Object.keys(row.customFields).forEach((k) => cfKeys.add(k));
      }
    }

    const headers = [
      "Name", "Email", "Phone", "Status", "Temperature", "Source",
      "Assigned To", "Lead Value", "Follow-up Date", "Created At",
      "Industry", "Address",
      ...Array.from(cfKeys),
    ];

    const csvRows = [headers.join(",")];

    for (const row of rows) {
      const values = [
        row.name, row.email, row.phone, row.status, row.temperature,
        row.source, row.assignedTo, row.leadValue, row.followUpDate, row.createdAt,
        row.industry, row.address,
        ...Array.from(cfKeys).map((k) => row.customFields?.[k] ?? ""),
      ];
      csvRows.push(values.map((v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
    }

    const csv = csvRows.join("\n");
    const date = new Date().toISOString().split("T")[0];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-export-${date}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    logger.error("Export leads error:", error);
    res.status(500).json({ success: false, message: "Export failed" });
  }
};
