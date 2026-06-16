import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { requirePlanFeature } from "../middlewares/plan-feature.middleware";
import { createPaymentLink } from "@/controllers/organization/payment-links/createpaymentlink.controller";
import { getPaymentLinks } from "@/controllers/organization/payment-links/getpaymentlinks.controller";
import { deletePaymentLink } from "@/controllers/organization/payment-links/deletepaymentlink.controller";

const router = Router();

const paymentLinksAccess = [isAuthenticated, requireOrgOwnerAccess, requirePlanFeature("paymentLinks")];

// ==================== PAYMENT LINKS ROUTES ====================

router.post("/", ...paymentLinksAccess, createPaymentLink);
router.get("/", ...paymentLinksAccess, getPaymentLinks);
router.delete("/:id", ...paymentLinksAccess, deletePaymentLink);

export default router;
