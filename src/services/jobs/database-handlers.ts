import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
export async function retryWebhooks(client: PoolClient) {
    const logs = await client.query(`SELECT * FROM lead_webhook_logs WHERE status='pending_retry' AND next_retry_at<=now()
    ORDER BY next_retry_at,id LIMIT 10 FOR UPDATE SKIP LOCKED`);
    for (const log of logs.rows) {
        await client.query("SAVEPOINT webhook_attempt");
        try {
            if (log.lead_id) {
                await client.query("UPDATE lead_webhook_logs SET status='retried_success',next_retry_at=NULL WHERE id=$1", [log.id]);
                continue;
            }
            const webhook = (await client.query("SELECT org_id,name,field_mapping FROM lead_webhooks WHERE id=$1 AND active=true", [log.webhook_id])).rows[0];
            if (!webhook || !log.payload || typeof log.payload !== "object")
                throw new Error("Webhook unavailable");
            const owner = (await client.query(`SELECT user_id FROM user_organizations WHERE organization_id=$1
        ORDER BY CASE WHEN role IN ('owner','org') THEN 0 ELSE 1 END,id LIMIT 1`, [webhook.org_id])).rows[0];
            if (!owner)
                throw new Error("Webhook organization has no user");
            const payload = log.payload;
            const mapped: Record<string, unknown> = {};
            for (const [external, field] of Object.entries(webhook.field_mapping ?? {})) {
                if (payload[external] !== undefined)
                    mapped[String(field)] = payload[external];
            }
            const id = randomUUID();
            await client.query(`INSERT INTO clients (id,organization_id,name,email,status,type,webhook_id,webhook_name,created_by,position,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'New Lead','lead',$5,$6,$7,0,now(),now())`, [id, webhook.org_id, mapped.name || payload.name || "Lead sem nome", mapped.email || payload.email || "retry-" + log.id + "@noemail.invalid", log.webhook_id, webhook.name, owner.user_id]);
            await client.query("UPDATE lead_webhook_logs SET status='retried_success',lead_id=$2,retry_count=COALESCE(retry_count,0)+1,next_retry_at=NULL,error=NULL WHERE id=$1", [log.id, id]);
        }
        catch {
            await client.query("ROLLBACK TO SAVEPOINT webhook_attempt");
            const attempts = (log.retry_count ?? 0) + 1;
            await client.query(`UPDATE lead_webhook_logs SET retry_count=$2,status=$3,error='Retry failed; check webhook configuration',
        next_retry_at=CASE WHEN $3='pending_retry' THEN now()+($4 * interval '1 second') ELSE NULL END WHERE id=$1`, [log.id, attempts, attempts >= (log.max_retries ?? 3) ? "permanently_failed" : "pending_retry", [60, 300, 1800][Math.min(attempts - 1, 2)]]);
        }
        finally {
            await client.query("RELEASE SAVEPOINT webhook_attempt");
        }
    }
}
export async function followupReminders(client: PoolClient) {
    const result = await client.query(`SELECT c.* FROM clients c WHERE type IN ('lead','client') AND follow_up_at<=now()
    AND status NOT IN ('lost','Completed','Inactive') AND (followup_notified_at IS NULL OR followup_notified_at<follow_up_at)
    ORDER BY follow_up_at,id LIMIT 100 FOR UPDATE SKIP LOCKED`);
    for (const lead of result.rows) {
        const user = lead.assigned_to || (await client.query("SELECT user_id FROM user_organizations WHERE organization_id=$1 AND role IN ('owner','org') ORDER BY id LIMIT 1", [lead.organization_id])).rows[0]?.user_id;
        if (!user)
            continue;
        const hours = (Date.now() - new Date(lead.follow_up_at).getTime()) / 3600000;
        const overdue = hours > 24;
        const suffix = lead.follow_up_note ? " ? " + lead.follow_up_note : "";
        await client.query(`INSERT INTO notifications (id,user_id,organization_id,type,title,message,read,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,false,now())`, [randomUUID(), user, lead.organization_id,
            overdue ? "lead_followup_overdue" : "lead_followup_due", (overdue ? "Overdue follow-up: " : "Follow-up due: ") + lead.name,
            (overdue ? "Follow-up with " + lead.name + " was due " + Math.floor(hours / 24) + " days ago." : "Your follow-up with " + lead.name + " is due today.") + suffix]);
        await client.query("UPDATE clients SET followup_notified_at=now() WHERE id=$1", [lead.id]);
    }
}
