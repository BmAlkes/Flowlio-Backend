import express from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { getOrgInteractions } from "@/controllers/organization/clients/getorginteractions.controller";

const router = express.Router();

router.get("/interactions", isAuthenticated, getOrgInteractions);

export default router;
