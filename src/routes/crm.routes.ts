import express from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { getOrgInteractions } from "@/controllers/organization/clients/getorginteractions.controller";
import { createOrgInteraction } from "@/controllers/organization/clients/createorginteraction.controller";
import { deleteInteraction } from "@/controllers/organization/clients/deleteinteraction.controller";
import { replyToInteraction } from "@/controllers/organization/clients/replyinteraction.controller";

const router = express.Router();

router.get("/interactions", isAuthenticated, getOrgInteractions);
router.post("/interactions", isAuthenticated, createOrgInteraction);
router.post("/interactions/:interactionId/reply", isAuthenticated, replyToInteraction);
router.delete("/interactions/:interactionId", isAuthenticated, deleteInteraction);

export default router;
