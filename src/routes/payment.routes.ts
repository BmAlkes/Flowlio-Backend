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

const router = Router();

// Legacy one-time order endpoints (kept for backwards compat / upgrade flows)
router.post("/paypal/create-order", createPayPalOrder);
router.post("/paypal/capture-order", capturePayPalOrder);

// Recurring subscription endpoints
router.post("/paypal/create-subscription", createPayPalSubscription);
router.post("/paypal/activate-subscription", activatePayPalSubscription);
router.post("/paypal/webhook", handlePayPalWebhook);

export default router;
