import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { canManageClients, type Actor } from '../../security/resource-policy';
import { enqueue } from '../../services/jobs/queue';

export class PortalInvitationError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
type Invitation = { clientId: string; userId: string; email: string; organizationId: string; issuedBy: string; hash: string; language: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const identifier = (id: string) => `portal-invitation:${id}`;
const input = z.object({ key: z.string().uuid(), language: z.enum(['en', 'pt', 'es', 'he']).default('en') });
const acceptInput = z.object({ token: z.string().regex(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/), password: z.string().min(8).max(128) });

async function target(c: PoolClient, actor: Actor, clientId: string) {
  if (!actor.organizationId || !canManageClients(actor)) throw new PortalInvitationError(403, 'FORBIDDEN');
  const row = (await c.query(`select cl.id,cl.user_id,cl.email,cl.portal_access_enabled,u.role,u.status,u.email as identity_email
    from clients cl join users u on u.id=cl.user_id where cl.id=$1 and cl.organization_id=$2 for update of cl`, [clientId, actor.organizationId])).rows[0];
  if (!row || row.role !== 'client' || row.status !== 'active' || row.email !== row.identity_email) throw new PortalInvitationError(404, 'CLIENT_NOT_FOUND');
  return row;
}
async function audit(c: PoolClient, org: string, actor: string, action: string, clientId: string) {
  await c.query(`insert into business_audit_events(id,organization_id,actor_kind,actor_id,action,resource_type,resource_id,operation_id,changes)
    values($1,$2,'human',$3,$4,'client',$5,$6,'{}')`, [randomUUID(), org, actor, action, clientId, randomUUID()]);
}
async function validRecipient(c: PoolClient, invitation: Invitation) {
  return (await c.query(`select cl.id,cl.user_id,cl.name,cl.email,o.name as organization_name from clients cl
    join users u on u.id=cl.user_id join organizations o on o.id=cl.organization_id
    join users issuer on issuer.id=$5
    where cl.id=$1 and cl.organization_id=$2 and cl.user_id=$3 and cl.email=$4 and u.email=$4
    and cl.portal_access_enabled=false and u.role='client' and u.status='active' and issuer.status='active'
    and (issuer.role in ('superadmin','subadmin') or (issuer.role='user' and (issuer.is_organization_owner=true or issuer.is_organization_manager=true)
      and exists(select 1 from user_organizations m where m.user_id=issuer.id and m.organization_id=o.id and m.status='active')))
    and o.status='active' and o.subscription_status in ('active','trialing') and (o.subscription_end_date is null or o.subscription_end_date>now())`,
  [invitation.clientId, invitation.organizationId, invitation.userId, invitation.email, invitation.issuedBy])).rows[0];
}
async function view(c: PoolClient, client: {id: string; portal_access_enabled: boolean}) {
  if (client.portal_access_enabled) return {state: 'active', expiresAt: null};
  const row = (await c.query(`select v.id,v.expires_at,j.status as delivery_status from verification v
    left join durable_jobs j on j.dedupe_key='portal-invitation:'||v.id where v.identifier=$1 order by v.created_at desc limit 1`, [identifier(client.id)])).rows[0];
  if (!row) return {state: 'not_invited', expiresAt: null};
  const state = new Date(row.expires_at).getTime() <= Date.now() ? 'expired'
    : row.delivery_status === 'completed' ? 'pending'
    : ['failed','uncertain'].includes(row.delivery_status) ? row.delivery_status : 'queued';
  return {state, expiresAt: row.expires_at};
}

export function createPortalInvitations(pool: Pool, hashPassword: (password: string) => Promise<string>) {
  async function transaction<T>(run: (c: PoolClient) => Promise<T>) {
    const c = await pool.connect();
    try { await c.query('begin'); const result = await run(c); await c.query('commit'); return result; }
    catch (error) { await c.query('rollback'); throw error; } finally { c.release(); }
  }
  const status = (actor: Actor, clientId: string) => transaction(async c => view(c, await target(c, actor, clientId)));
  const issue = (actor: Actor, clientId: string, body: unknown) => transaction(async c => {
    const data = input.parse(body), client = await target(c, actor, clientId);
    if (client.portal_access_enabled) throw new PortalInvitationError(409, 'PORTAL_ALREADY_ACTIVE');
    const existing = (await c.query('select payload from durable_jobs where dedupe_key=$1', ['portal-invitation:'+data.key])).rows[0];
    if (existing) {
      const same = await c.query('select 1 from verification where id=$1 and identifier=$2', [data.key,identifier(clientId)]);
      if (!same.rowCount && (existing.payload.clientId !== clientId || existing.payload.organizationId !== actor.organizationId)) throw new PortalInvitationError(409, 'KEY_REUSED');
      return view(c, client);
    }
    const recent = await c.query("select 1 from verification where identifier=$1 and created_at>now()-interval '60 seconds'", [identifier(clientId)]);
    if (recent.rowCount) throw new PortalInvitationError(429, 'INVITATION_COOLDOWN');
    const secret = randomBytes(32).toString('hex');
    const value: Invitation = {clientId, userId: client.user_id, email: client.email, organizationId: actor.organizationId!, issuedBy: actor.id, hash: hash(secret), language: data.language};
    await c.query('delete from verification where identifier=$1', [identifier(clientId)]);
    await c.query("insert into verification(id,identifier,value,expires_at,created_at,updated_at) values($1,$2,$3,now()+interval '48 hours',now(),now())", [data.key, identifier(clientId), JSON.stringify(value)]);
    await enqueue(c, 'portal-invitation', 'portal-invitation:'+data.key, {invitationId: data.key, token: data.key+'.'+secret, clientId, organizationId: actor.organizationId});
    await audit(c, actor.organizationId!, actor.id, 'client.portal_invited', clientId);
    return view(c, client);
  });
  const revoke = (actor: Actor, clientId: string) => transaction(async c => {
    const client = await target(c, actor, clientId);
    if (client.portal_access_enabled) throw new PortalInvitationError(409, 'PORTAL_ALREADY_ACTIVE');
    const removed = await c.query('delete from verification where identifier=$1 returning id', [identifier(clientId)]);
    for (const row of removed.rows) await c.query("update durable_jobs set payload=(payload::jsonb-'token')::json where dedupe_key=$1", ['portal-invitation:'+row.id]);
    if (removed.rowCount) await audit(c, actor.organizationId!, actor.id, 'client.portal_invitation_revoked', clientId);
    return view(c, client);
  });
  const accept = async (body: unknown) => {
    const data = acceptInput.parse(body), [id, secret] = data.token.split('.');
    // Verify before hashing to avoid expensive work on random invalid requests.
    const initial = (await pool.query("select value from verification where id=$1 and identifier like 'portal-invitation:%' and expires_at>now()", [id])).rows[0];
    if (!initial || (JSON.parse(initial.value) as Invitation).hash !== hash(secret)) throw new PortalInvitationError(400, 'INVITATION_INVALID');
    const password = await hashPassword(data.password);
    return transaction(async c => {
      const snapshot = JSON.parse(initial.value) as Invitation;
      await c.query('select id from clients where id=$1 for update', [snapshot.clientId]);
      const row = (await c.query("select value from verification where id=$1 and identifier=$2 and expires_at>now() for update", [id, identifier(snapshot.clientId)])).rows[0];
      if (!row) throw new PortalInvitationError(400, 'INVITATION_INVALID');
      const invitation = JSON.parse(row.value) as Invitation;
      if (invitation.hash !== hash(secret) || !await validRecipient(c, invitation)) throw new PortalInvitationError(400, 'INVITATION_INVALID');
      const account = await c.query("update account set password=$2,updated_at=now() where user_id=$1 and provider_id='credential' returning id", [invitation.userId, password]);
      if (account.rowCount !== 1) throw new PortalInvitationError(400, 'INVITATION_INVALID');
      await c.query('update users set email_verified=true,updated_at=now() where id=$1', [invitation.userId]);
      await c.query('update clients set portal_access_enabled=true,updated_at=now() where id=$1', [invitation.clientId]);
      await c.query('delete from session where user_id=$1', [invitation.userId]);
      await c.query('delete from verification where id=$1', [id]);
      await c.query("update durable_jobs set payload=(payload::jsonb-'token')::json where dedupe_key=$1", ['portal-invitation:'+id]);
      await audit(c, invitation.organizationId, invitation.userId, 'client.portal_invitation_accepted', invitation.clientId);
      return {accepted: true};
    });
  };
  return {status, issue, revoke, accept};
}

export async function deliverPortalInvitation(c: PoolClient, payload: Record<string, unknown>, baseUrl: string, send: (email: string, name: string, title: string, message: string, url: string) => Promise<boolean>) {
  const row = (await c.query("select value from verification where id=$1 and identifier like 'portal-invitation:%' and expires_at>now()", [payload.invitationId])).rows[0];
  if (!row || typeof payload.token !== 'string') return;
  const invitation = JSON.parse(row.value) as Invitation;
  if (hash(payload.token.split('.')[1] ?? '') !== invitation.hash) return;
  const recipient = await validRecipient(c, invitation);
  if (!recipient) return;
  const url = new URL('/portal-invitation', baseUrl); url.hash = 'token='+encodeURIComponent(payload.token);
  const copy: Record<string, [string,string]> = {
    pt: ['Convite para o portal do cliente', 'Defina sua senha para acessar projetos e aprovações. Este convite expira em 48 horas.'],
    en: ['Invitation to the client portal', 'Set your password to access projects and approvals. This invitation expires in 48 hours.'],
    es: ['Invitación al portal del cliente', 'Define tu contraseña para acceder a proyectos y aprobaciones. Esta invitación vence en 48 horas.'],
    he: ['הזמנה לפורטל הלקוחות', 'הגדירו סיסמה כדי לגשת לפרויקטים ולאישורים. ההזמנה תקפה ל-48 שעות.'],
  };
  const [title, message] = copy[invitation.language] ?? copy.en;
  if (!await send(recipient.email, recipient.name, title, recipient.organization_name+'\n'+message, url.href)) throw new Error('Portal invitation delivery unconfirmed');
  await c.query("update durable_jobs set payload=(payload::jsonb-'token')::json where dedupe_key=$1", ['portal-invitation:'+payload.invitationId]);
}
