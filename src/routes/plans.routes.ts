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

router.get("/public/getallplans", getPublicPlans as any);

router.post("/create_singleplan", isAuthenticated, createSinglePlan as any);

router.get("/getallplans", isAuthenticated, getAllPlans as any);

router.post("/upsert", isAuthenticated, upsertPlan as any);

router.delete("/:id", isAuthenticated, deletePlan as any);

router.delete("/features/delete", isAuthenticated, deleteCustomFeatures as any);

export default router;
