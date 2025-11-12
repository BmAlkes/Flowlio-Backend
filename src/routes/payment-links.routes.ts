import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { createPaymentLink } from "@/controllers/organization/payment-links/createpaymentlink.controller";
import { getPaymentLinks } from "@/controllers/organization/payment-links/getpaymentlinks.controller";
import { deletePaymentLink } from "@/controllers/organization/payment-links/deletepaymentlink.controller";

const router = Router();

// ==================== PAYMENT LINKS ROUTES ====================

// Create payment link - requires authentication
router.post("/", isAuthenticated, createPaymentLink);

// Get payment links - requires authentication
router.get("/", isAuthenticated, getPaymentLinks);

// Delete payment link - requires authentication
router.delete("/:id", isAuthenticated, deletePaymentLink);

export default router;
