import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  createProposal,
  getOrganizationProposals,
  getClientProposals,
  approveProposal,
  rejectProposal,
} from "../controllers/proposals/proposals.controller";

const router = Router();

// Org owner / admin: create a proposal (called from AI Assist after generating)
router.post("/", isAuthenticated, createProposal);

// Org owner / admin: view all proposals sent by the organization
router.get("/organization", isAuthenticated, getOrganizationProposals);

// Client portal: view proposals addressed to this client
router.get("/client", isAuthenticated, getClientProposals);

// Client: approve a proposal
router.put("/:id/approve", isAuthenticated, approveProposal);

// Client: reject a proposal
router.put("/:id/reject", isAuthenticated, rejectProposal);

export default router;
