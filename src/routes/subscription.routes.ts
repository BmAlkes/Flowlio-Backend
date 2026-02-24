import { Router } from "express";
import * as subscriptionController from "@/controllers/user/subscription.controller";
import * as upgradeController from "@/controllers/user/upgradeplan.controller";
import { requireActiveSubscription } from "@/middlewares/subscription.middleware";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

router.get(
  "/status",
  isAuthenticated,
  subscriptionController.getSubscriptionStatus
);

router.get("/plans", subscriptionController.getAvailablePlans);

router.put(
  "/update-plan",
  isAuthenticated,
  subscriptionController.updateSubscriptionPlan
);

router.post(
  "/cancel",
  isAuthenticated,
  subscriptionController.cancelSubscription
);

router.post(
  "/upgrade/create-order",
  isAuthenticated,
  upgradeController.createUpgradeOrder
);
router.post(
  "/upgrade/capture-order",
  isAuthenticated,
  upgradeController.captureUpgradeOrder
);

router.use("/", requireActiveSubscription);

export default router;
