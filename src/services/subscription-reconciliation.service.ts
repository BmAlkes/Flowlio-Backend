import axios from "axios";
import type { Pool, PoolClient } from "pg";
import { getPayPalAccessToken, getPayPalBaseURL } from "../utils/paypal.util";
import { enqueue, type Job } from "./jobs/queue";
import { addBillingPeriod, providerState, type PayPalSnapshot } from "./subscription-policy";

export async function fetchPayPalSubscription(id: string): Promise<PayPalSnapshot> {
    const token = await getPayPalAccessToken();
    const { data } = await axios.get(`${getPayPalBaseURL()}/v1/billing/subscriptions/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
    });
    if (data.id !== id) throw new Error("PayPal subscription identifier mismatch");
    return data;
}

async function cancelAtPayPal(id: string) {
    const token = await getPayPalAccessToken();
    await axios.post(`${getPayPalBaseURL()}/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`,
        { reason: "Cancellation requested by the account owner" },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
}

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '15s'");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
}

/** Called inside a transaction; the row lock covers provider reads as well as writes. */
export async function reconcileSubscription(client: PoolClient, id: string, fetch = fetchPayPalSubscription, cancel = cancelAtPayPal) {
    const sub = (await client.query(`SELECT s.*, p.paypal_plan_id FROM subscriptions s
        JOIN subscription_plans p ON p.id=s.plan_id WHERE s.paypal_subscription_id=$1 FOR UPDATE OF s`, [id])).rows[0];
    if (!sub) throw new Error("PayPal subscription not linked yet");
    let snapshot = await fetch(id);
    if (sub.paypal_plan_id && snapshot.plan_id !== sub.paypal_plan_id) throw new Error("PayPal plan mismatch");
    if (sub.metadata?.cancellationRequestedAt && !["CANCELLED", "EXPIRED"].includes(snapshot.status)) {
        await cancel(id);
        snapshot = await fetch(id);
        if (!["CANCELLED", "EXPIRED"].includes(snapshot.status)) throw new Error("Cancellation not confirmed");
    }
    const state = providerState(snapshot, new Date(sub.current_period_end), new Date(), sub.metadata?.paypalLastPaymentAt);
    const metadata = { ...sub.metadata,
        ...(state.end > new Date(sub.current_period_end) ? { paypalLastPaymentAt: snapshot.billing_info?.last_payment?.time } : {}),
        paypalStatus: snapshot.status, lastSyncedAt: new Date().toISOString() };
    await client.query(`UPDATE subscriptions SET status=$2,current_period_end=$3,cancel_at_period_end=$4,
        cancelled_at=CASE WHEN $4 THEN COALESCE(cancelled_at,now()) ELSE cancelled_at END,
        metadata=$5,updated_at=now() WHERE id=$1`, [sub.id, state.status, state.end, state.cancel, JSON.stringify(metadata)]);
    await client.query(`UPDATE organizations SET subscription_status=$2,subscription_end_date=$3,updated_at=now()
        WHERE id=$1 AND subscription_plan_id=$4`, [sub.organization_id, state.status, state.end, sub.plan_id]);
    await client.query("UPDATE subscription_events SET processed_at=now() WHERE paypal_subscription_id=$1 AND processed_at IS NULL", [id]);
    return state;
}

/** Inbox and queue are committed together before acknowledging a verified notification. */
export async function acceptSubscriptionEvent(client: PoolClient, id: string, eventType: string, providerId?: string) {
    const inserted = await client.query(`INSERT INTO subscription_events(id,event_type,paypal_subscription_id,processed_at)
        VALUES($1,$2,$3,CASE WHEN $3::text IS NULL THEN now() ELSE NULL END) ON CONFLICT DO NOTHING RETURNING id`, [id, eventType, providerId || null]);
    if (inserted.rowCount && providerId) await enqueue(client, "subscription-reconcile", "paypal-event:" + id, { providerId, eventId: id });
}

export async function reconcileEvent(job: Job, client: PoolClient) {
    await reconcileSubscription(client, String(job.payload.providerId));
    if (job.payload.eventId) await client.query("UPDATE subscription_events SET processed_at=now() WHERE id=$1", [job.payload.eventId]);
}

/** Sweep every account, including past_due and cancellations missed during an outage. */
export async function scheduleSubscriptionReconciliation(job: Job, client: PoolClient) {
    const rows = (await client.query(`SELECT s.*,p.price,p.duration_type,p.duration_value FROM subscriptions s
        JOIN subscription_plans p ON p.id=s.plan_id ORDER BY s.id FOR UPDATE OF s`)).rows;
    for (const sub of rows) {
        if (sub.paypal_subscription_id) {
            await enqueue(client, "subscription-reconcile", job.id + ":" + sub.id, { providerId: sub.paypal_subscription_id });
            continue;
        }
        if (!["active", "past_due"].includes(sub.status) || new Date(sub.current_period_end) > new Date()) continue;
        let end = new Date(sub.current_period_end);
        let status = sub.cancel_at_period_end ? "cancelled" : "past_due";
        if (!sub.cancel_at_period_end && Number(sub.price) === 0) {
            // Keep the original calendar anchor even after missed runs and short months.
            let periods = 1;
            const anchor = new Date(sub.current_period_start);
            do {
                end = addBillingPeriod(anchor, sub.duration_type || "monthly", (Number(sub.duration_value) || 1) * periods++);
            } while (end <= new Date());
            status = "active";
        }
        await client.query("UPDATE subscriptions SET status=$2,current_period_end=$3,updated_at=now() WHERE id=$1", [sub.id,status,end]);
        await client.query(`UPDATE organizations SET subscription_status=$2,subscription_end_date=$3,updated_at=now()
            WHERE id=$1 AND subscription_plan_id=$4`, [sub.organization_id,status,end,sub.plan_id]);
    }
}
