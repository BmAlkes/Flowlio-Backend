import { Router } from "express";
import {
  createPayPalOrder,
  capturePayPalOrder,
} from "../controllers/user/payment.controller";

const router = Router();

// ==================== PAYMENT ROUTES ====================

// Create PayPal order (for checkout flow - no auth required initially)
router.post("/paypal/create-order", createPayPalOrder);

// Capture PayPal order (for completing payment - no auth required initially)
router.post("/paypal/capture-order", capturePayPalOrder);

export default router;
