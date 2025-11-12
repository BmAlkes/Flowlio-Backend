import { Router } from "express";
import {
  getSubscriptionStatus,
  getAvailablePlans,
  updateSubscriptionPlan,
} from "@/controllers/user/subscription.controller";
import { requireActiveSubscription } from "@/middlewares/subscription.middleware";
import { isAuthenticated } from "@/middlewares/auth.middleware";

const router = Router();

// Simple test endpoint to verify authentication
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Test endpoint working",
    user: req.user || null,
    authenticated: !!req.user,
  });
});

// Get subscription status (requires authentication)
router.get("/status", isAuthenticated, getSubscriptionStatus as any);

// Get available plans (no authentication required)
router.get("/plans", getAvailablePlans as any);

// Update subscription plan (requires authentication)
router.put("/update-plan", isAuthenticated, updateSubscriptionPlan as any);

// Protected routes that require active subscription
router.use("/", requireActiveSubscription as any);

export default router;
