import express from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { getOrgInteractions } from "@/controllers/organization/clients/getorginteractions.controller";
import { replyToInteraction } from "@/controllers/organization/clients/replyinteraction.controller";

const router = express.Router();

router.get("/interactions", isAuthenticated, getOrgInteractions);
router.post("/interactions/:interactionId/reply", isAuthenticated, replyToInteraction);

export default router;
