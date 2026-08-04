import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requirePlanFeature } from "../middlewares/plan-feature.middleware";
import {
  createProposal,
  getOrganizationProposals,
  getClientProposals,
  approveProposal,
  rejectProposal,
  uploadManualProposal,
  deleteProposal,
} from "../controllers/proposals/proposals.controller";
import { getProposalsByClient } from "../controllers/proposals/getproposalsbyclient.controller";
import { upload } from "../controllers/ai/aiAssistant.controller";

const router = Router();

// Org-facing routes require proposalsAccess feature
const orgProposals = [isAuthenticated, requirePlanFeature("proposalsAccess")];

// Org owner / admin: create a proposal (called from AI Assist after generating)
router.post("/", ...orgProposals, createProposal);

// Org owner / admin: upload a manual proposal
router.post("/upload", ...orgProposals, upload.single("file"), uploadManualProposal);

// Org owner / admin: view all proposals sent by the organization
router.get("/organization", ...orgProposals, getOrganizationProposals);

// Org owner: delete a proposal
router.delete("/:id", ...orgProposals, deleteProposal);

// Org-facing: proposals for a specific client (client profile page)
router.get("/client/:clientId", ...orgProposals, getProposalsByClient);

// Client-facing routes — no plan check (client responds to proposals, not the org)
router.get("/client", isAuthenticated, getClientProposals);
router.put("/:id/approve", isAuthenticated, approveProposal);
router.put("/:id/reject", isAuthenticated, rejectProposal);

export default router;
