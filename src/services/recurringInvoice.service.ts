import { database } from "@/configs/connection.config";
import { invoices, recurringInvoices } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export class RecurringInvoiceService {
  /**
   * Calculates the next run date based on frequency
   */
  static calculateNextRunDate(currentDate: Date, frequency: "daily" | "weekly" | "monthly" | "yearly"): Date {
    const nextDate = new Date(currentDate);
    switch (frequency) {
      case "daily":
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      case "weekly":
        nextDate.setDate(nextDate.getDate() + 7);
        break;
      case "monthly":
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      case "yearly":
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;
    }
    return nextDate;
  }

  /**
   * Generates a new invoice from a recurring template
   */
  static async generateInvoiceFromTemplate(template: any) {
    try {
      if (!template || template.status !== "active") {
        return null;
      }

      // Generate invoice number (simple sequential)
      const invoiceCount = await database.query.invoices.findMany({
        where: (invoices, { eq }) => eq(invoices.organizationId, template.organizationId),
      });
      const nextNumber = (invoiceCount.length + 1).toString().padStart(5, "0");
      const invoiceNumber = `REC-${nextNumber}`;

      // Create the invoice
      const invoiceData = {
        id: randomUUID(),
        organizationId: template.organizationId,
        clientId: template.clientId,
        createdBy: template.createdBy,
        invoiceNumber: invoiceNumber,
        clientname: template.clientname,
        amount: template.amount,
        status: "draft",
        description: template.description || null,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days due date
      };

      const [newInvoice] = await database.insert(invoices).values(invoiceData).returning();

      // Update template run dates
      const nextRun = this.calculateNextRunDate(new Date(template.nextRunDate), template.frequency as any);
      
      let newStatus = template.status;
      if (template.endDate && nextRun > new Date(template.endDate)) {
        newStatus = "completed";
      }

      await database.update(recurringInvoices)
        .set({
          lastRunDate: new Date(),
          nextRunDate: nextRun,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(recurringInvoices.id, template.id));

      logger.info(`✅ Generated recurring invoice ${invoiceNumber} from template ${template.id}`);
      return newInvoice;
    } catch (error) {
      logger.error(`❌ Failed to generate invoice from template ${template.id}:`, error);
      throw error;
    }
  }

  /**
   * Processes all due recurring invoices
   */
  static async processRecurringInvoices() {
    const now = new Date();
    try {
      const dueTemplates = await database.query.recurringInvoices.findMany({
        where: (recurringInvoices, { and, eq, lte }) => and(
          eq(recurringInvoices.status, "active"),
          lte(recurringInvoices.nextRunDate, now)
        ),
      });

      if (dueTemplates.length === 0) {
        logger.info("ℹ️ No recurring invoices due today.");
        return;
      }

      logger.info(`🔄 Processing ${dueTemplates.length} due recurring invoices...`);

      for (const template of dueTemplates) {
        await this.generateInvoiceFromTemplate(template);
      }
    } catch (error) {
      logger.error("❌ Error processing recurring invoices:", error);
    }
  }
}
