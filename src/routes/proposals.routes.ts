import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import {
  createProposal,
  getOrganizationProposals,
  getClientProposals,
  approveProposal,
  rejectProposal,
  uploadManualProposal,
  deleteProposal,
} from "../controllers/proposals/proposals.controller";
import { upload } from "../controllers/ai/aiAssistant.controller";

const router = Router();

// Org owner / admin: create a proposal (called from AI Assist after generating)
router.post("/", isAuthenticated, createProposal);

// Org owner / admin: upload a manual proposal
router.post("/upload", isAuthenticated, upload.single("file"), uploadManualProposal);

// Org owner / admin: view all proposals sent by the organization
router.get("/organization", isAuthenticated, getOrganizationProposals);

// Client portal: view proposals addressed to this client
router.get("/client", isAuthenticated, getClientProposals);

// Client: approve a proposal
router.put("/:id/approve", isAuthenticated, approveProposal);

// Client: reject a proposal
router.put("/:id/reject", isAuthenticated, rejectProposal);

// Org owner: delete a proposal
router.delete("/:id", isAuthenticated, deleteProposal);

export default router;
