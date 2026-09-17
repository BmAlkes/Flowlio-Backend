export function isInvoicedTimeConstraint(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; constraint?: string; cause?: unknown };
  return (value.code === "23503" && value.constraint?.startsWith("invoice_time_items_time_entry_id") === true)
    || (value.cause !== error && isInvoicedTimeConstraint(value.cause));
}
