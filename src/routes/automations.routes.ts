import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireSuperAdmin } from "@/middlewares/role.middleware";
import { runTaskOverdueAutomation } from "@/controllers/automations/runTaskOverdue.controller";
import { runProjectRiskAutomation } from "@/controllers/automations/runProjectRisk.controller";
import { runLeadFollowupAutomation } from "@/controllers/automations/runLeadFollowup.controller";
import { runWeeklySummaryAutomation } from "@/controllers/automations/runWeeklySummary.controller";

const router = Router();

// Manual triggers for QA — superadmin only
router.post("/task-overdue/run", isAuthenticated, requireSuperAdmin, runTaskOverdueAutomation as any);
router.post("/project-risk/run", isAuthenticated, requireSuperAdmin, runProjectRiskAutomation as any);
router.post("/lead-followup/run", isAuthenticated, requireSuperAdmin, runLeadFollowupAutomation as any);
router.post("/weekly-summary/run", isAuthenticated, requireSuperAdmin, runWeeklySummaryAutomation as any);

export default router;
