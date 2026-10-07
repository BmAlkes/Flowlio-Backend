import type { Pool } from 'pg';

/** Calendar rollover never closes a statement or charges a client. */
export async function syncRetainerMonths(pool: Pool) {
 const rows = (await pool.query(`select r.id,to_char(now() at time zone r.timezone,'YYYY-MM') month
  from retainers r where r.state='active' and r.renewal='automatic'
  and exists(select 1 from retainer_project_links l where l.retainer_id=r.id)
  and r.start_month<=to_char(now() at time zone r.timezone,'YYYY-MM')
  and (r.end_month is null or r.end_month>=to_char(now() at time zone r.timezone,'YYYY-MM'))
  and not exists(select 1 from retainer_periods p where p.retainer_id=r.id and p.month=to_char(now() at time zone r.timezone,'YYYY-MM'))
  order by r.id limit 100`)).rows;
 for (const row of rows) await pool.query('select ensure_retainer_month($1,$2)', [row.id,row.month]);
}
