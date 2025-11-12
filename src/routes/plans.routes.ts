import { Router } from "express";
import {
  createSinglePlan,
  getAllPlans,
  getPublicPlans,
  upsertPlan,
  deletePlan,
  deleteCustomFeatures,
} from "@/controllers/super admin/plans";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

// ==================== PUBLIC ROUTES (No Authentication Required) ====================
router.get("/public/getallplans", getPublicPlans as any);

// ==================== CREATE ROUTES ====================
router.post("/create_singleplan", isAuthenticated, createSinglePlan as any);

// ==================== GET ROUTES ====================
router.get("/getallplans", isAuthenticated, getAllPlans as any);

// ==================== UPSERT / UPDATE ROUTES ====================
router.post("/upsert", isAuthenticated, upsertPlan as any);

// ==================== DELETE AND FEATURES DELETE ROUTES ====================
router.delete("/:id", isAuthenticated, deletePlan as any);
router.delete("/features/delete", isAuthenticated, deleteCustomFeatures as any);

export default router;
