import { z } from "zod";

export class TimeInvoicingError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
const period = {
  clientId: z.string().min(1).max(128),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
};
const validPeriod = (value: { start: string; end: string }) => new Date(value.start) < new Date(value.end);
export const timeBillingFilterSchema = z.object(period).strict().refine(validPeriod, "Invalid date range");
export const timeInvoiceSchema = z.object({
  ...period,
  requestKey: z.string().uuid(),
  entries: z.array(z.object({ id: z.string().min(1).max(128), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(500),
  fallbackRate: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + "T00:00:00Z");
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Invalid due date").optional(),
}).strict().refine(validPeriod, "Invalid date range").refine(
  value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, "Duplicate time entries",
);
export type TimeBillingFilter = z.infer<typeof timeBillingFilterSchema>;
export type TimeInvoiceInput = z.infer<typeof timeInvoiceSchema>;
export const MAX_INVOICE_CENTS = BigInt("9999999999");
export function moneyToCents(value: string): bigint {
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(value)) throw new TimeInvoicingError(400, "INVALID_RATE", "Enter a valid hourly rate with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
}
export function formatCents(value: bigint): string {
  return (value / BigInt(100)).toString() + "." + (value % BigInt(100)).toString().padStart(2, "0");
}
export function priceTime(minutes: number, storedRate: string | null, fallbackRate?: string) {
  const rate = storedRate ?? fallbackRate;
  if (rate === undefined) throw new TimeInvoicingError(400, "RATE_REQUIRED", "Enter a fallback rate for entries without a recorded hourly rate.");
  const cents = moneyToCents(rate);
  if (cents <= BigInt(0) || !Number.isSafeInteger(minutes) || minutes <= 0) {
    throw new TimeInvoicingError(400, "INVALID_RATE", "Selected time must have positive duration and hourly rate.");
  }
  const amountCents = (BigInt(minutes) * cents + BigInt(30)) / BigInt(60);
  if (amountCents > MAX_INVOICE_CENTS) throw new TimeInvoicingError(400, "AMOUNT_TOO_LARGE", "Invoice amount exceeds the supported limit.");
  return { hourlyRate: formatCents(cents), amount: formatCents(amountCents), amountCents };
}
