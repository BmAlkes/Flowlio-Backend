import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { Actor } from "../../security/resource-policy";
export class OnboardingError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
type Steps = Record<string, { completedAt: string } | null>;
function context(actor: Actor) {
  if (!actor.organizationId || actor.role !== 'user') throw new OnboardingError(403, 'FORBIDDEN');
  const role = actor.isOrganizationOwner ? 'admin' : actor.isOrganizationManager ? 'manager' : 'member';
  const keys = role === 'member' ? ['complete_task', 'log_time', 'update_profile'] : ['create_client', 'create_project', 'approve_delivery'];
  return { role, keys };
}
async function evidence(client: PoolClient, actor: Actor, role: string): Promise<Record<string, boolean>> {
  if (role === 'member') {
    const row = (await client.query(`select
      exists(select 1 from tasks t join projects p on p.id=t.project_id where p.organization_id=$1 and t.assigned_to=$2 and t.status='completed'
        and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')) as complete_task,
      exists(select 1 from time_entries e join projects p on p.id=e.project_id left join tasks t on t.id=e.task_id
        where p.organization_id=$1 and e.user_id=$2 and e.duration>0 and e.end_time>=e.start_time
        and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')
        and (e.task_id is null or t.created_by=$2 or t.assigned_to=$2 or t.visibility='public')) as log_time,
      exists(select 1 from users where id=$2 and nullif(image,'') is not null) as update_profile`, [actor.organizationId, actor.id])).rows[0];
    return row;
  }
  return (await client.query(`select
    exists(select 1 from clients where organization_id=$1) as create_client,
    exists(select 1 from projects p where organization_id=$1 and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')) as create_project,
    exists(select 1 from delivery_reviews r join projects p on p.id=r.project_id where r.organization_id=$1 and p.organization_id=$1
      and r.state='approved' and r.decided_at is not null and (p.created_by=$2 or p.assigned_to=$2 or p.visibility='public')) as approve_delivery`, [actor.organizationId, actor.id])).rows[0];
}
export function createOnboarding(pool: Pool) {
  async function refresh(actor: Actor, options: { step?: unknown; dismissed?: boolean } = {}) {
    const { role, keys } = context(actor);
    let requestedStep: string | undefined;
    if (options.step !== undefined) {
      const parsed = z.string().max(100).safeParse(options.step);
      if (!parsed.success || !keys.includes(parsed.data)) throw new OnboardingError(400, 'INVALID_STEP');
      requestedStep = parsed.data;
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into onboarding_progress(organization_id,user_id,role) values($1,$2,$3) on conflict do nothing', [actor.organizationId, actor.id, role]);
      const row = (await client.query('select * from onboarding_progress where organization_id=$1 and user_id=$2 and role=$3 for update', [actor.organizationId, actor.id, role])).rows[0];
      const facts = await evidence(client, actor, role), now = new Date().toISOString();
      const steps: Steps = Object.fromEntries(keys.map(key => [key, row.steps[key] ?? (facts[key] ? { completedAt: now } : null)]));
      if (requestedStep && !steps[requestedStep]) throw new OnboardingError(409, 'STEP_NOT_COMPLETE');
      const completed = Object.values(steps).filter(Boolean).length;
      const activatedAt = row.completed_at ?? (completed === keys.length ? now : null);
      const dismissed = options.dismissed ?? row.dismissed;
      await client.query('update onboarding_progress set steps=$4,dismissed=$5,completed_at=$6,updated_at=now() where organization_id=$1 and user_id=$2 and role=$3', [actor.organizationId, actor.id, role, JSON.stringify(steps), dismissed, activatedAt]);
      await client.query('commit');
      return { role, steps, dismissed, completedAt: activatedAt, metrics: { completed, total: keys.length, startedAt: row.started_at, activatedAt } };
    } catch (error) { await client.query('rollback'); throw error; } finally { client.release(); }
  }
  return { refresh };
}
