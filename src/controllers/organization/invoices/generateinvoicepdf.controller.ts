import { Request, Response } from "express";
import { invoices } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { eq, and } from "drizzle-orm";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import puppeteer from "puppeteer";

export interface GenerateInvoicePDFRequest {
  params: {
    id: string;
  };
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const generateInvoicePDF = async (
  req: GenerateInvoicePDFRequest & Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    // Get invoice data
    const invoice = await database
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.organizationId, req.user!.organizationId as string)
        )
      )
      .limit(1);

    if (invoice.length === 0) {
      res.status(404).json({
        success: false,
        message: "Invoice not found",
      });
      return;
    }

    const invoiceData = invoice[0];

    // Generate HTML for PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Invoice ${invoiceData.invoiceNumber}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          .header { text-align: center; margin-bottom: 40px; }
          .invoice-details { margin-bottom: 30px; }
          .client-info { margin-bottom: 30px; }
          .amount { font-size: 24px; font-weight: bold; color: #1797b9; }
          .footer { margin-top: 50px; text-align: center; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>INVOICE</h1>
          <h2>${invoiceData.invoiceNumber}</h2>
        </div>
        
        <div class="invoice-details">
          <p><strong>Date:</strong> ${new Date(
            invoiceData.createdAt
          ).toLocaleDateString()}</p>
          <p><strong>Status:</strong> ${invoiceData.status.toUpperCase()}</p>
          ${
            invoiceData.dueDate
              ? `<p><strong>Due Date:</strong> ${new Date(
                  invoiceData.dueDate
                ).toLocaleDateString()}</p>`
              : ""
          }
        </div>
        
        <div class="client-info">
          <h3>Bill To:</h3>
          <p><strong>${invoiceData.clientname}</strong></p>
        </div>
        
        <div class="amount">
          <p>Amount: $${parseFloat(invoiceData.amount).toFixed(2)}</p>
        </div>
        
        ${
          invoiceData.description
            ? `<div><p><strong>Description:</strong> ${invoiceData.description}</p></div>`
            : ""
        }
        
        <div class="footer">
          <p>Thank you for your business!</p>
        </div>
      </body>
      </html>
    `;

    // Generate PDF using Puppeteer
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    const pdfBuffer = await page.pdf({
      format: "A4",
      margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
    });
    await browser.close();

    // Convert PDF buffer to base64
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    // Upload PDF to Cloudinary
    const uploadResult = await uploadToCloudinary(pdfDataUrl, "invoices");

    // Update invoice with PDF URL
    await database
      .update(invoices)
      .set({
        pdfUrl: uploadResult.secure_url,
        pdfFileName: `invoice-${invoiceData.invoiceNumber}.pdf`,
        pdfFileSize: uploadResult.bytes,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id));

    logger.info("Invoice PDF generated successfully:", {
      invoiceId: id,
      invoiceNumber: invoiceData.invoiceNumber,
      pdfUrl: uploadResult.secure_url,
    });

    res.status(200).json({
      success: true,
      message: "Invoice PDF generated successfully",
      data: {
        pdfUrl: uploadResult.secure_url,
        pdfFileName: `invoice-${invoiceData.invoiceNumber}.pdf`,
        pdfFileSize: uploadResult.bytes,
      },
    });
  } catch (error) {
    logger.error("Error generating invoice PDF:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to generate invoice PDF",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
