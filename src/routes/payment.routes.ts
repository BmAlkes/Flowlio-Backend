import { Router } from "express";
import {
  createPayPalOrder,
  capturePayPalOrder,
} from "../controllers/user/payment.controller";
import {
  createPayPalSubscription,
  activatePayPalSubscription,
  handlePayPalWebhook,
} from "../controllers/user/paypalSubscriptions.controller";
import { isAuthenticated } from "../middlewares/auth.middleware";

const router = Router();

// Legacy one-time order endpoints (kept for backwards compat / upgrade flows)
router.post("/paypal/create-order", isAuthenticated, createPayPalOrder);
router.post("/paypal/capture-order", isAuthenticated, capturePayPalOrder);

// Recurring subscription endpoints
router.post("/paypal/create-subscription", isAuthenticated, createPayPalSubscription);
router.post("/paypal/activate-subscription", isAuthenticated, activatePayPalSubscription);
// Webhook is called by PayPal's servers — no session auth, validated via HMAC signature
router.post("/paypal/webhook", handlePayPalWebhook);

export default router;
