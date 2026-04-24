import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { getFinancialOverview } from "@/controllers/reports/financial-overview.controller";
import { getClientActivityReport } from "@/controllers/reports/client-activity.controller";

const router = Router();

// /api/reports/financial-overview
router.get("/financial-overview", isAuthenticated, requireOrgOwnerAccess, getFinancialOverview as any);

// /api/reports/client-activity
router.get("/client-activity", isAuthenticated, requireOrgOwnerAccess, getClientActivityReport as any);

export default router;
