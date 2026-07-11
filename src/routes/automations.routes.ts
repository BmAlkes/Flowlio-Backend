import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireSuperAdmin } from "@/middlewares/role.middleware";
import { runTaskOverdueAutomation } from "@/controllers/automations/runTaskOverdue.controller";
import { runProjectRiskAutomation } from "@/controllers/automations/runProjectRisk.controller";

const router = Router();

// Manual triggers for QA — superadmin only
router.post(
  "/task-overdue/run",
  isAuthenticated,
  requireSuperAdmin,
  runTaskOverdueAutomation as any,
);

router.post(
  "/project-risk/run",
  isAuthenticated,
  requireSuperAdmin,
  runProjectRiskAutomation as any,
);

export default router;
