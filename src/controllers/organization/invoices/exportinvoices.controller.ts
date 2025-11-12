import { Response } from "express";
import { z } from "zod";
import { invoices } from "../../../schema/schema";
import { eq } from "drizzle-orm";
import puppeteer from "puppeteer";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { database } from "../../../configs/connection.config";
import { logger } from "../../../utils/logger.util";

const exportInvoicesSchema = z.object({
  invoiceIds: z.array(z.string().uuid()),
  exportType: z.enum(["selected", "currentPage"]),
});

interface ExportInvoicesRequest {
  body: z.infer<typeof exportInvoicesSchema>;
  user?: {
    id: string;
    email: string;
    organizationId?: string;
  };
}

export const exportInvoices = async (
  req: ExportInvoicesRequest,
  res: Response
) => {
  try {
    logger.info("Export invoices request received:", {
      body: req.body,
      user: req.user?.id,
    });

    // Validate request body
    const validatedData = exportInvoicesSchema.parse(req.body);
    const organizationId = req.user!.organizationId as string;

    logger.info("Validated data:", {
      invoiceIds: validatedData.invoiceIds,
      exportType: validatedData.exportType,
      organizationId,
    });

    // Fetch invoices based on IDs
    let invoicesToExport;
    try {
      logger.info("Fetching invoices from database...");
      logger.info("Query parameters:", {
        organizationId,
        invoiceIds: validatedData.invoiceIds,
      });

      // Try a simpler query first to test
      invoicesToExport = await database
        .select()
        .from(invoices)
        .where(eq(invoices.organizationId, organizationId));

      logger.info(
        `Found ${invoicesToExport.length} total invoices for organization`
      );

      // Filter by invoice IDs
      invoicesToExport = invoicesToExport.filter((invoice) =>
        validatedData.invoiceIds.includes(invoice.id)
      );

      logger.info(
        `Filtered to ${invoicesToExport.length} invoices matching IDs`
      );
      logger.info("Database query completed successfully");
    } catch (dbError) {
      logger.error("Database query error:", dbError);
      throw dbError;
    }

    if (invoicesToExport.length === 0) {
      res.status(404).json({
        success: false,
        message: "No invoices found to export",
      });
      return;
    }

    logger.info(`Found ${invoicesToExport.length} invoices to export`);

    // Generate HTML content for PDF
    let htmlContent;
    try {
      logger.info("Starting HTML content generation...");
      htmlContent = generateInvoiceExportHTML(invoicesToExport);
      logger.info("HTML content generated successfully");
    } catch (htmlError) {
      logger.error("Error generating HTML content:", htmlError);
      throw htmlError;
    }

    // Generate PDF using Puppeteer
    let browser;
    try {
      logger.info("Launching Puppeteer browser...");
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--single-process",
          "--disable-gpu",
        ],
      });
      logger.info("Browser launched successfully");

      const page = await browser.newPage();
      logger.info("New page created");

      await page.setContent(htmlContent, { waitUntil: "networkidle0" });
      logger.info("HTML content set on page");

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: {
          top: "20mm",
          right: "20mm",
          bottom: "20mm",
          left: "20mm",
        },
      });
      logger.info("PDF generated successfully");

      await browser.close();
      logger.info("Browser closed successfully");

      // Upload PDF to Cloudinary
      logger.info("Uploading PDF to Cloudinary...");
      const base64Pdf = Buffer.from(pdfBuffer).toString("base64");
      const uploadResult = await uploadToCloudinary(
        `data:application/pdf;base64,${base64Pdf}`,
        "invoice-exports"
      );
      logger.info("PDF uploaded to Cloudinary successfully");

      logger.info("Invoice export PDF generated and uploaded successfully:", {
        pdfUrl: uploadResult.secure_url,
        invoiceCount: invoicesToExport.length,
      });

      res.json({
        success: true,
        message: `${invoicesToExport.length} invoices exported successfully`,
        downloadUrl: uploadResult.secure_url,
      });
    } catch (puppeteerError) {
      logger.error("Puppeteer error:", puppeteerError);
      if (browser) {
        await browser.close();
      }
      throw puppeteerError;
    }
  } catch (error) {
    logger.error("Export invoices error:", error);
    logger.error("Error details:", {
      name: error instanceof Error ? error.name : "Unknown",
      message: error instanceof Error ? error.message : "Unknown",
      stack: error instanceof Error ? error.stack : "Unknown",
    });

    if (error instanceof z.ZodError) {
      res.status(400).json({
        success: false,
        message: "Invalid request data",
        errors: error.errors,
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: "Failed to export invoices",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

function generateInvoiceExportHTML(invoices: any[]): string {
  const currentDate = new Date().toLocaleDateString();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Invoice Export</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          color: #333;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 2px solid #1797b9;
          padding-bottom: 20px;
        }
        .header h1 {
          color: #1797b9;
          margin: 0;
          font-size: 28px;
        }
        .header p {
          margin: 5px 0 0 0;
          color: #666;
        }
        .invoice-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .invoice-table th,
        .invoice-table td {
          border: 1px solid #ddd;
          padding: 12px;
          text-align: left;
        }
        .invoice-table th {
          background-color: #1797b9;
          color: white;
          font-weight: bold;
        }
        .invoice-table tr:nth-child(even) {
          background-color: #f9f9f9;
        }
        .invoice-table tr:hover {
          background-color: #f5f5f5;
        }
        .summary {
          margin-top: 30px;
          padding: 20px;
          background-color: #f8f9fa;
          border-radius: 8px;
        }
        .summary h3 {
          color: #1797b9;
          margin-top: 0;
        }
        .footer {
          margin-top: 40px;
          text-align: center;
          color: #666;
          font-size: 12px;
        }
        .amount {
          text-align: right;
          font-weight: bold;
        }
        .status {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
        }
        .status.paid {
          background-color: #d4edda;
          color: #155724;
        }
        .status.pending {
          background-color: #fff3cd;
          color: #856404;
        }
        .status.overdue {
          background-color: #f8d7da;
          color: #721c24;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Invoice Export Report</h1>
        <p>Generated on ${currentDate}</p>
      </div>

      <table class="invoice-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Client</th>
            <th>Amount</th>
            <th>Due Date</th>
            <th>Status</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          ${invoices
            .map(
              (invoice) => `
            <tr>
              <td>${invoice.invoiceNumber}</td>
              <td>${invoice.clientname || "N/A"}</td>
              <td class="amount">$${invoice.amount?.toFixed(2) || "0.00"}</td>
              <td>${
                invoice.dueDate
                  ? new Date(invoice.dueDate).toLocaleDateString()
                  : "N/A"
              }</td>
              <td>
                <span class="status ${getStatusClass(invoice)}">
                  ${getStatusText(invoice)}
                </span>
              </td>
              <td>${invoice.description || "N/A"}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="summary">
        <h3>Export Summary</h3>
        <p><strong>Total Invoices:</strong> ${invoices.length}</p>
        <p><strong>Total Amount:</strong> $${invoices
          .reduce((sum, invoice) => sum + (invoice.amount || 0), 0)
          .toFixed(2)}</p>
        <p><strong>Paid Invoices:</strong> ${
          invoices.filter((invoice) => invoice.datepaid).length
        }</p>
        <p><strong>Pending Invoices:</strong> ${
          invoices.filter(
            (invoice) =>
              !invoice.datepaid && new Date(invoice.dueDate || "") > new Date()
          ).length
        }</p>
        <p><strong>Overdue Invoices:</strong> ${
          invoices.filter(
            (invoice) =>
              !invoice.datepaid && new Date(invoice.dueDate || "") < new Date()
          ).length
        }</p>
      </div>

      <div class="footer">
        <p>This report was generated by Flowlio Invoice Management System</p>
        <p>For support, contact your system administrator</p>
      </div>
    </body>
    </html>
  `;
}

function getStatusClass(invoice: any): string {
  if (invoice.datepaid) return "paid";
  if (invoice.dueDate && new Date(invoice.dueDate) < new Date())
    return "overdue";
  return "pending";
}

function getStatusText(invoice: any): string {
  if (invoice.datepaid) return "Paid";
  if (invoice.dueDate && new Date(invoice.dueDate) < new Date())
    return "Overdue";
  return "Pending";
}
