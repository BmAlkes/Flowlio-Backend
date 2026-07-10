import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireSuperAdmin } from "@/middlewares/role.middleware";
import { runTaskOverdueAutomation } from "@/controllers/automations/runTaskOverdue.controller";

const router = Router();

// Manual trigger for QA — superadmin only
router.post(
  "/task-overdue/run",
  isAuthenticated,
  requireSuperAdmin,
  runTaskOverdueAutomation as any,
);

export default router;
