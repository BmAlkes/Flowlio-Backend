import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createInvoice } from "@/controllers/organization/invoices/createinvoice.controller";
import { getInvoices } from "@/controllers/organization/invoices/getinvoices.controller";
import { deleteInvoice } from "@/controllers/organization/invoices/deleteinvoice.controller";
import { generateInvoicePDF } from "@/controllers/organization/invoices/generateinvoicepdf.controller";
import { exportInvoices } from "@/controllers/organization/invoices/exportinvoices.controller";
import { getInvoicesByClient } from "@/controllers/organization/invoices/getinvoicesbyclient.controller";
import { updateInvoiceStatus } from "@/controllers/organization/invoices/updateinvoicestatus.controller";
import { createRecurringTemplate } from "@/controllers/organization/invoices/recurring/createrecurringtemplate.controller";
import { getRecurringTemplates } from "@/controllers/organization/invoices/recurring/getrecurringtemplates.controller";
import { updateRecurringTemplate } from "@/controllers/organization/invoices/recurring/updaterecurringtemplate.controller";
import { deleteRecurringTemplate } from "@/controllers/organization/invoices/recurring/deleterecurringtemplate.controller";

const router = Router();

const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

router.post("/", ...orgOwner, createInvoice);
router.get("/", ...orgOwner, getInvoices);
router.post("/client/:clientId", isAuthenticated, getInvoicesByClient);
router.post("/:id/generate-pdf", ...orgOwner, generateInvoicePDF);
router.put("/:id/status", ...orgOwner, updateInvoiceStatus as any);
router.delete("/:id", ...orgOwner, deleteInvoice);
router.post("/export", ...orgOwner, exportInvoices);

// Recurring Invoices
router.post("/recurring", ...orgOwner, createRecurringTemplate);
router.get("/recurring", ...orgOwner, getRecurringTemplates);
router.put("/recurring/:id", ...orgOwner, updateRecurringTemplate);
router.delete("/recurring/:id", ...orgOwner, deleteRecurringTemplate);

export default router;
