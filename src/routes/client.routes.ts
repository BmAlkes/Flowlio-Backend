import express from "express";
import { createClient } from "../controllers/organization/client management/createclient.controller";
import { getClients } from "../controllers/organization/client management/getclients.controller";
import { deleteClient } from "../controllers/organization/client management/deleteclient.controller";
import { updateClient } from "../controllers/organization/client management/updateclient.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = express.Router();

// Increase body size limit for client routes (for image uploads)
router.use(express.json({ limit: "50mb" }));
router.use(express.urlencoded({ limit: "50mb", extended: true }));

// Client management routes
router.post("/create", isAuthenticated, createClient as any);
router.get("/", isAuthenticated, getClients as any);
router.delete("/:id", isAuthenticated, deleteClient as any);
router.put("/:id", isAuthenticated, updateClient as any);

export default router;
