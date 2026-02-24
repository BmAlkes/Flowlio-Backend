import express from "express";
import { createClient } from "../controllers/organization/client management/createclient.controller";
import { getClients } from "../controllers/organization/client management/getclients.controller";
import { deleteClient } from "../controllers/organization/client management/deleteclient.controller";
import { updateClient } from "../controllers/organization/client management/updateclient.controller";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";

const router = express.Router();

const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

// Increase body size limit for client routes (for image uploads)
router.use(express.json({ limit: "50mb" }));
router.use(express.urlencoded({ limit: "50mb", extended: true }));

router.post("/create", ...orgOwner, createClient);
router.get("/", ...orgOwner, getClients);
router.delete("/:id", ...orgOwner, deleteClient);
router.put("/:id", ...orgOwner, updateClient);

export default router;
