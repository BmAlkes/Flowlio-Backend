import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
import { getFinancialOverview } from "@/controllers/reports/financial-overview.controller";
import { getClientActivityReport } from "@/controllers/reports/client-activity.controller";
import { getMemberTasks, getClientProjects, getProjectBreakdown } from "@/controllers/reports/drilldown.controller";

const router = Router();

const analytics = [isAuthenticated, requireOrgOwnerAccess, requirePlanFeature("analyticsAccess")];

// /api/reports/financial-overview
router.get("/financial-overview", ...analytics, getFinancialOverview as any);

// /api/reports/client-activity
router.get("/client-activity", ...analytics, getClientActivityReport as any);

// Drill-down endpoints
router.get("/member/:userId/tasks", ...analytics, getMemberTasks as any);
router.get("/client/:clientId/projects", ...analytics, getClientProjects as any);
router.get("/project/:projectId/breakdown", ...analytics, getProjectBreakdown as any);

export default router;
