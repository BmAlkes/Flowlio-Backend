import express from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";

// Phase 1 — lead CRUD
import { createLead } from "@/controllers/organization/leads/createLead.controller";
import { getLeads } from "@/controllers/organization/leads/getLeads.controller";
import { getLead } from "@/controllers/organization/leads/getLead.controller";
import { updateLead } from "@/controllers/organization/leads/updateLead.controller";
import { deleteLead } from "@/controllers/organization/leads/deleteLead.controller";
import { convertLead } from "@/controllers/organization/leads/convertLead.controller";

// Phase 2 — custom field definitions
import { getLeadFields } from "@/controllers/organization/leads/fields/getLeadFields.controller";
import { createLeadField } from "@/controllers/organization/leads/fields/createLeadField.controller";
import { updateLeadField } from "@/controllers/organization/leads/fields/updateLeadField.controller";
import { deleteLeadField } from "@/controllers/organization/leads/fields/deleteLeadField.controller";
import { reorderLeadFields } from "@/controllers/organization/leads/fields/reorderLeadFields.controller";
import { getLeadCustomValues } from "@/controllers/organization/leads/fields/getLeadCustomValues.controller";
import { updateLeadCustomValues } from "@/controllers/organization/leads/fields/updateLeadCustomValues.controller";

// Phase 3 — assignment, tags, routing, bulk, export
import { assignLead } from "@/controllers/organization/leads/leadAssignment.controller";
import { getTags, createTag, updateTag, deleteTag, setLeadTags } from "@/controllers/organization/leads/leadTags.controller";
import { getRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule, reorderRoutingRules } from "@/controllers/organization/leads/leadRouting.controller";
import { bulkLeadAction, checkDuplicate, exportLeads } from "@/controllers/organization/leads/leadBulk.controller";

// Existing controllers
import { reorderLeads } from "@/controllers/organization/client management/reorderleads.controller";
import { updateLeadStatus } from "@/controllers/organization/clients/updateleadstatus.controller";
import { getClientTimeline, addClientInteraction } from "@/controllers/organization/clients/clientinteractions.controller";
import { deleteClientInteraction } from "@/controllers/organization/clients/deleteclientinteraction.controller";
import { getLeadInsights } from "@/controllers/organization/clients/leadinsights.controller";
import { updateLeadTemperature } from "@/controllers/organization/clients/updateleadtemperature.controller";
import { updateLeadValue } from "@/controllers/organization/clients/updateleadvalue.controller";
import { updateLeadFollowUp, getPendingFollowUps, getFollowUpsDashboard } from "@/controllers/organization/clients/leadfollowup.controller";

const router = express.Router();

const auth = [isAuthenticated];
const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

// ── Phase 2: custom field definitions (must be before /:id routes) ──
router.get("/fields", ...auth, getLeadFields as any);
router.post("/fields", ...orgOwner, createLeadField as any);
router.put("/fields/reorder", ...orgOwner, reorderLeadFields as any);
router.patch("/fields/:fieldId", ...orgOwner, updateLeadField as any);
router.delete("/fields/:fieldId", ...orgOwner, deleteLeadField as any);

// ── Phase 3: tags (before /:id routes) ──
router.get("/tags", ...auth, getTags as any);
router.post("/tags", ...orgOwner, createTag as any);
router.patch("/tags/:tagId", ...orgOwner, updateTag as any);
router.delete("/tags/:tagId", ...orgOwner, deleteTag as any);

// ── Phase 3: routing rules ──
router.get("/routing-rules", ...orgOwner, getRoutingRules as any);
router.post("/routing-rules", ...orgOwner, createRoutingRule as any);
router.patch("/routing-rules/:ruleId", ...orgOwner, updateRoutingRule as any);
router.delete("/routing-rules/:ruleId", ...orgOwner, deleteRoutingRule as any);
router.put("/routing-rules/reorder", ...orgOwner, reorderRoutingRules as any);

// ── Phase 3: bulk ops, duplicate check, export ──
router.post("/bulk", ...orgOwner, bulkLeadAction as any);
router.post("/check-duplicate", ...auth, checkDuplicate as any);
router.get("/export", ...orgOwner, exportLeads as any);

// ── Phase 1: lead CRUD ──
router.post("/", ...orgOwner, createLead as any);
router.get("/", ...auth, getLeads as any);

// ── Existing routes that must precede /:id ──
router.patch("/reorder", ...orgOwner, reorderLeads as any);
router.patch("/status", ...auth, updateLeadStatus as any);
router.get("/followups/pending", ...auth, getPendingFollowUps as any);
router.get("/followups/dashboard", ...auth, getFollowUpsDashboard as any);
router.get("/timeline/:id", ...auth, getClientTimeline as any);
router.post("/timeline", ...auth, addClientInteraction as any);
router.delete("/timeline/:interactionId", ...auth, deleteClientInteraction as any);
router.get("/insights/:id", ...auth, getLeadInsights as any);

// ── Phase 1+3: parameterised lead routes ──
router.get("/:id", ...auth, getLead as any);
router.patch("/:id", ...auth, updateLead as any);
router.delete("/:id", ...orgOwner, deleteLead as any);
router.post("/:id/convert", ...orgOwner, convertLead as any);
router.patch("/:id/assign", ...orgOwner, assignLead as any);
router.post("/:id/tags", ...orgOwner, setLeadTags as any);

// ── Phase 2: custom values per lead ──
router.get("/:id/fields", ...auth, getLeadCustomValues as any);
router.patch("/:id/fields", ...auth, updateLeadCustomValues as any);

// ── Existing /:clientId routes ──
router.patch("/:clientId/temperature", ...auth, updateLeadTemperature as any);
router.patch("/:clientId/value", ...auth, updateLeadValue as any);
router.patch("/:clientId/followup", ...auth, updateLeadFollowUp as any);

export default router;
