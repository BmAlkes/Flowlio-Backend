import { Router } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { checkAIAccess } from "@/middlewares/ai-rbac.middleware";
import {
  getUsage,
  getLimits,
  getAllLimits,
  setLimits,
  removeLimits,
  getAudit,
} from "@/controllers/ai/aiMonitoring.controller";

const router = Router();

router.get("/usage", isAuthenticated, checkAIAccess, getUsage);
router.get("/limits/all", isAuthenticated, checkAIAccess, getAllLimits);
router.get("/limits", isAuthenticated, checkAIAccess, getLimits);
router.put("/limits", isAuthenticated, checkAIAccess, setLimits);
router.delete("/limits/:orgId", isAuthenticated, checkAIAccess, removeLimits);
router.get("/audit", isAuthenticated, checkAIAccess, getAudit);

export default router;
