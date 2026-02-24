import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createPaymentLink } from "@/controllers/organization/payment-links/createpaymentlink.controller";
import { getPaymentLinks } from "@/controllers/organization/payment-links/getpaymentlinks.controller";
import { deletePaymentLink } from "@/controllers/organization/payment-links/deletepaymentlink.controller";

const router = Router();

const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

// ==================== PAYMENT LINKS ROUTES ====================

router.post("/", ...orgOwner, createPaymentLink);
router.get("/", ...orgOwner, getPaymentLinks);
router.delete("/:id", ...orgOwner, deletePaymentLink);

export default router;
