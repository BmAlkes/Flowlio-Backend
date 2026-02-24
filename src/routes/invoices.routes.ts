import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createInvoice } from "@/controllers/organization/invoices/createinvoice.controller";
import { getInvoices } from "@/controllers/organization/invoices/getinvoices.controller";
import { deleteInvoice } from "@/controllers/organization/invoices/deleteinvoice.controller";
import { generateInvoicePDF } from "@/controllers/organization/invoices/generateinvoicepdf.controller";
import { exportInvoices } from "@/controllers/organization/invoices/exportinvoices.controller";

const router = Router();

const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

router.post("/", ...orgOwner, createInvoice);
router.get("/", ...orgOwner, getInvoices);
router.post("/:id/generate-pdf", ...orgOwner, generateInvoicePDF);
router.delete("/:id", ...orgOwner, deleteInvoice);
router.post("/export", ...orgOwner, exportInvoices);

export default router;
