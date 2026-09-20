export interface PayPalSnapshot {
    id: string;
    plan_id: string;
    status: string;
    custom_id?: string;
    start_time?: string;
    billing_info?: {
        next_billing_time?: string;
        failed_payments_count?: number;
        outstanding_balance?: { value: string };
        last_payment?: { time: string };
    };
}

export function validDate(value: string | undefined): Date | undefined {
    if (!value) return;
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
}

/** UTC calendar arithmetic, clamped at month end (Jan 31 -> Feb 28/29). */
export function addBillingPeriod(start: Date, type: string, count: number): Date {
    if (!Number.isInteger(count) || count < 1) throw new Error("Invalid billing duration");
    const result = new Date(start);
    if (type === "days" || type === "day") result.setUTCDate(result.getUTCDate() + count);
    else if (["monthly", "month", "yearly", "year"].includes(type)) {
        const day = result.getUTCDate();
        result.setUTCDate(1);
        result.setUTCMonth(result.getUTCMonth() + count * (type.startsWith("year") ? 12 : 1));
        const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
        result.setUTCDate(Math.min(day, lastDay));
    } else throw new Error("Unsupported billing duration");
    return result;
}

export function providerState(snapshot: PayPalSnapshot, currentEnd: Date, now = new Date(), previousPayment?: string) {
    let end = currentEnd;
    const billing = snapshot.billing_info;
    const next = validDate(billing?.next_billing_time);
    const payment = validDate(billing?.last_payment?.time);
    const paid = !!payment && payment <= now && !(Number(billing?.failed_payments_count) > 0)
        && !(Number(billing?.outstanding_balance?.value) > 0);
    // A scheduled next charge alone is not evidence that the current period was paid.
    if (snapshot.status === "ACTIVE" && paid && next && next > end
        && (!previousPayment || (payment && payment > new Date(previousPayment)))) end = next;
    switch (snapshot.status) {
        case "ACTIVE": return { status: end > now ? "active" : "past_due", end, cancel: false };
        case "CANCELLED": return { status: end > now ? "active" : "cancelled", end, cancel: true };
        case "SUSPENDED": return { status: "past_due", end, cancel: false };
        case "EXPIRED": return { status: "expired", end, cancel: false };
        case "APPROVAL_PENDING":
        case "APPROVED": return { status: "unpaid", end, cancel: false };
        default: throw new Error("Unknown PayPal subscription status");
    }
}

export function eventSubscriptionId(event: { event_type?: string; resource?: { id?: string; billing_agreement_id?: string } }): string | undefined {
    if (event.event_type?.startsWith("BILLING.SUBSCRIPTION.")) return event.resource?.id;
    if (["PAYMENT.SALE.COMPLETED", "PAYMENT.SALE.REFUNDED", "PAYMENT.SALE.REVERSED"].includes(event.event_type || ""))
        return event.resource?.billing_agreement_id;
}
