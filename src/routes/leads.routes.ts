import express from "express";
import { reorderLeads } from "../controllers/organization/client management/reorderleads.controller";
import { updateLeadStatus } from "../controllers/organization/clients/updateleadstatus.controller";
import { getClientTimeline, addClientInteraction } from "../controllers/organization/clients/clientinteractions.controller";
import { deleteClientInteraction } from "../controllers/organization/clients/deleteclientinteraction.controller";
import { getLeadInsights } from "../controllers/organization/clients/leadinsights.controller";
import { updateLeadTemperature } from "../controllers/organization/clients/updateleadtemperature.controller";
import { updateLeadValue } from "../controllers/organization/clients/updateleadvalue.controller";
import { updateLeadFollowUp, getPendingFollowUps, getFollowUpsDashboard } from "../controllers/organization/clients/leadfollowup.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";

const router = express.Router();

const auth = [isAuthenticated];
const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

router.patch("/reorder", ...orgOwner, reorderLeads as any);
router.patch("/status", ...auth, updateLeadStatus as any);
router.get("/timeline/:id", ...auth, getClientTimeline as any);
router.post("/timeline", ...auth, addClientInteraction as any);
router.delete("/timeline/:interactionId", ...auth, deleteClientInteraction as any);
router.get("/insights/:id", ...auth, getLeadInsights as any);
router.patch("/:id/temperature", ...auth, updateLeadTemperature as any);
router.patch("/:clientId/value", ...auth, updateLeadValue as any);
router.patch("/:clientId/followup", ...auth, updateLeadFollowUp as any);
router.get("/followups/pending", ...auth, getPendingFollowUps as any);
router.get("/followups/dashboard", ...auth, getFollowUpsDashboard as any);

export default router;
