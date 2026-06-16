import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { getFinancialOverview } from "@/controllers/reports/financial-overview.controller";
import { getClientActivityReport } from "@/controllers/reports/client-activity.controller";

const router = Router();

const analytics = [isAuthenticated, requireOrgOwnerAccess, requirePlanFeature("analyticsAccess")];

// /api/reports/financial-overview
router.get("/financial-overview", ...analytics, getFinancialOverview as any);

// /api/reports/client-activity
router.get("/client-activity", ...analytics, getClientActivityReport as any);

export default router;
