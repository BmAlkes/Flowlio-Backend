import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { requirePlanFeature } from "../middlewares/plan-feature.middleware";
import { createPaymentLink } from "@/controllers/organization/payment-links/createpaymentlink.controller";
import { getPaymentLinks } from "@/controllers/organization/payment-links/getpaymentlinks.controller";
import { deletePaymentLink } from "@/controllers/organization/payment-links/deletepaymentlink.controller";
import { getPublicPaymentLink } from "@/controllers/organization/payment-links/getpublicpaymentlink.controller";
import { updatePaymentLinkStatus } from "@/controllers/organization/payment-links/updatepaymentlinkstatus.controller";

const router = Router();

const paymentLinksAccess = [isAuthenticated, requireOrgOwnerAccess, requirePlanFeature("paymentLinks")];

// ==================== PAYMENT LINKS ROUTES ====================

// Public — no auth: returns only safe fields for the /pay/:id page
router.get("/public/:id", getPublicPaymentLink);

router.post("/", ...paymentLinksAccess, createPaymentLink);
router.get("/", ...paymentLinksAccess, getPaymentLinks);
router.patch("/:id/status", ...paymentLinksAccess, updatePaymentLinkStatus);
router.delete("/:id", ...paymentLinksAccess, deletePaymentLink);

export default router;
