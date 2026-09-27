import {invoiceCurrency} from '../utils/financial-currency';
import {organizations} from '@/schema/schema';
import {eq} from 'drizzle-orm';
import { database } from "@/configs/connection.config";
import { invoices } from "@/schema/schema";

type InvoiceTransaction = Parameters<Parameters<typeof database.transaction>[0]>[0];
type InvoiceInput = Omit<typeof invoices.$inferInsert, "invoiceNumber">;

/** The database allocates and persists the number in the invoice transaction. */
export async function insertNumberedInvoice(
  tx: InvoiceTransaction, series: "S1" | "REC", data: InvoiceInput,
) {
  const [org]=await tx.select({settings:organizations.settings}).from(organizations).where(eq(organizations.id,data.organizationId));
  const currencyCode=invoiceCurrency(data.currencyCode??org?.settings?.currency);
  const [invoice] = await tx.insert(invoices).values({ ...data, currencyCode, invoiceNumber: series + "-" }).returning();
  // Fail closed if a deployment omitted the required migration.
  if (!invoice || !new RegExp("^" + series + "-[0-9]{5,}$").test(invoice.invoiceNumber)) {
    throw new Error("Invoice numbering migration is required");
  }
  return invoice;
}
