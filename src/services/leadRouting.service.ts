import { database } from "@/configs/connection.config";
import { clients, leadRoutingRules, leadTagAssignments, notifications } from "@/schema/schema";
import { eq, and, asc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import crypto from "crypto";

interface LeadData {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  source?: string | null;
  webhookId?: string | null;
  industry?: string | null;
  customFields?: Record<string, any> | null;
}

function evaluateCondition(lead: LeadData, rule: { field: string; operator: string; value: string }): boolean {
  let fieldValue: string = "";

  if (rule.field === "source") fieldValue = lead.source ?? "";
  else if (rule.field === "webhookId") fieldValue = lead.webhookId ?? "";
  else if (rule.field === "email") fieldValue = lead.email ?? "";
  else if (rule.field === "phone") fieldValue = lead.phone ?? "";
  else if (rule.field === "name") fieldValue = lead.name ?? "";
  else if (rule.field === "industry") fieldValue = lead.industry ?? "";
  else if (rule.field.startsWith("customField:")) {
    const cfKey = rule.field.replace("customField:", "");
    fieldValue = String(lead.customFields?.[cfKey] ?? "");
  }

  const v = fieldValue.toLowerCase();
  const rv = rule.value.toLowerCase();

  switch (rule.operator) {
    case "equals": return v === rv;
    case "not_equals": return v !== rv;
    case "contains": return v.includes(rv);
    case "not_contains": return !v.includes(rv);
    case "starts_with": return v.startsWith(rv);
    case "ends_with": return v.endsWith(rv);
    case "is_empty": return v === "";
    case "is_not_empty": return v !== "";
    default: return false;
  }
}

export async function applyRoutingRules(orgId: string, lead: LeadData): Promise<void> {
  try {
    const rules = await database
      .select()
      .from(leadRoutingRules)
      .where(and(eq(leadRoutingRules.organizationId, orgId), eq(leadRoutingRules.isActive, true)))
      .orderBy(asc(leadRoutingRules.priority));

    for (const rule of rules) {
      const conditions = rule.conditions as any;
      const conditionRules = conditions?.rules ?? [];
      const matchType = conditions?.match ?? "all";

      const results = conditionRules.map((c: any) => evaluateCondition(lead, c));
      const matched = matchType === "all"
        ? results.every(Boolean)
        : results.some(Boolean);

      if (!matched) continue;

      // First match wins — apply actions
      const actions = rule.actions as any;
      const now = new Date();
      const updates: any = { updatedAt: now };

      if (actions.assignTo) {
        updates.assignedTo = actions.assignTo;
        updates.assignedAt = now;
      }
      if (actions.setTemperature) updates.leadTemperature = actions.setTemperature;
      if (actions.setStatus) updates.status = actions.setStatus;

      await database.update(clients).set(updates).where(eq(clients.id, lead.id));

      if (actions.addTags?.length > 0) {
        await database
          .insert(leadTagAssignments)
          .values(actions.addTags.map((tagId: string) => ({ leadId: lead.id, tagId })))
          .onConflictDoNothing();
      }

      if (actions.notify?.length > 0) {
        for (const userId of actions.notify) {
          database
            .insert(notifications)
            .values({
              id: crypto.randomUUID(),
              userId,
              organizationId: orgId,
              type: "lead_routed",
              title: `New lead: ${lead.name}`,
              message: `Lead "${lead.name}" matched routing rule "${rule.name}"`,
              read: false,
            })
            .catch(() => {});
        }
      }

      logger.info(`Lead ${lead.id} matched routing rule "${rule.name}" for org ${orgId}`);
      break; // first-match-wins
    }
  } catch (err) {
    logger.error("applyRoutingRules error:", err);
  }
}
