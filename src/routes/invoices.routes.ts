import { Router } from "express";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { createInvoice } from "@/controllers/organization/invoices/createinvoice.controller";
import { getInvoices } from "@/controllers/organization/invoices/getinvoices.controller";
import { deleteInvoice } from "@/controllers/organization/invoices/deleteinvoice.controller";
import { generateInvoicePDF } from "@/controllers/organization/invoices/generateinvoicepdf.controller";
import { exportInvoices } from "@/controllers/organization/invoices/exportinvoices.controller";

const router = Router();

// ==================== INVOICE ROUTES ====================

// Create invoice - requires authentication
router.post("/", isAuthenticated, createInvoice);

// Get invoices - requires authentication
router.get("/", isAuthenticated, getInvoices);

// Generate invoice PDF - requires authentication
router.post("/:id/generate-pdf", isAuthenticated, generateInvoicePDF);

// Delete invoice - requires authentication
router.delete("/:id", isAuthenticated, deleteInvoice);

// Export invoices - requires authentication
router.post("/export", isAuthenticated, exportInvoices);

export default router;
