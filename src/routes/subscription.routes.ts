import { Router } from "express";
import * as subscriptionController from "@/controllers/user/subscription.controller";
import * as upgradeController from "@/controllers/user/upgradeplan.controller";
import { requireActiveSubscription } from "@/middlewares/subscription.middleware";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

// Get subscription status (requires authentication)
router.get(
  "/status",
  isAuthenticated,
  subscriptionController.getSubscriptionStatus
);

// Get available plans (no authentication required)
router.get("/plans", subscriptionController.getAvailablePlans);

// Update subscription plan (requires authentication)
router.put(
  "/update-plan",
  isAuthenticated,
  subscriptionController.updateSubscriptionPlan
);

// Cancel subscription (requires authentication, non-refundable)
router.post(
  "/cancel",
  isAuthenticated,
  subscriptionController.cancelSubscription
);

// Plan upgrade routes (requires authentication)
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

// Protected routes that require active subscription
router.use("/", requireActiveSubscription);

export default router;
