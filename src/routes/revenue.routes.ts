import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { getRevenue, createRevenueEntry, updateRevenueEntry, deleteRevenueEntry } from "@/controllers/organization/revenue/revenue.controller";

const router = Router();

const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

router.get("/", ...orgOwner, getRevenue as any);
router.post("/", ...orgOwner, createRevenueEntry as any);
router.put("/:entryId", ...orgOwner, updateRevenueEntry as any);
router.delete("/:entryId", ...orgOwner, deleteRevenueEntry as any);

export default router;
