import { database } from "@/configs/connection.config";
import { recurringInvoices } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { insertNumberedInvoice } from "@/services/invoice-numbering.service";

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
  static async generateInvoiceFromTemplate(template: typeof recurringInvoices.$inferSelect) {
    try {
      if (!template || template.status !== "active") {
        return null;
      }

      return await database.transaction(async (tx) => {
        const [current] = await tx.select().from(recurringInvoices).where(and(
          eq(recurringInvoices.id, template.id), eq(recurringInvoices.organizationId, template.organizationId),
        )).for("update");
        if (!current || current.status !== "active" ||
            current.nextRunDate.getTime() !== new Date(template.nextRunDate).getTime()) return null;
        template = current;

        // Create the invoice
        const invoiceData = {
          id: randomUUID(),
          organizationId: template.organizationId,
          clientId: template.clientId,
          createdBy: template.createdBy,
          clientname: template.clientname,
          amount: template.amount,
          status: "draft",
          description: template.description || null,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Default 7 days due date
        };

        const newInvoice = await insertNumberedInvoice(tx, "REC", invoiceData);

        // Update template run dates
        const nextRun = this.calculateNextRunDate(new Date(template.nextRunDate), template.frequency);
      
        let newStatus = template.status;
        if (template.endDate && nextRun > new Date(template.endDate)) {
          newStatus = "completed";
        }

        await tx.update(recurringInvoices)
          .set({
            lastRunDate: new Date(),
            nextRunDate: nextRun,
            status: newStatus,
            updatedAt: new Date(),
          })
          .where(eq(recurringInvoices.id, template.id));

        logger.info(`✅ Generated recurring invoice ${newInvoice.invoiceNumber} from template ${template.id}`);
        return newInvoice;
      });
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
