/** Recognize the T29 guards through Drizzle's nested database error. */
export function retainerConstraint(error: unknown): 'time' | 'recurring' | null {
 if (!error || typeof error !== 'object') return null;
 const e = error as { code?: string; constraint?: string; message?: string; cause?: unknown };
 if (e.code === '23503' && e.constraint === 'invoice_time_items_time_entry_id_retainer') return 'time';
 if (e.code === '23514' && ['Recurring template belongs to a contract', 'Recurring terms belong to a contract'].includes(e.message ?? '')) return 'recurring';
 return e.cause !== error ? retainerConstraint(e.cause) : null;
}
