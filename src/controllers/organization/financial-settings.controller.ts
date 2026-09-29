import {recentActivities} from '@/schema/schema';
import {Request,Response} from 'express';
import {database} from '@/configs/connection.config';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {currencyCodeSchema,isCurrency} from '@/utils/financial-currency';
import {organizationCurrency} from '@/services/organization-currency.service';
import {logger} from '@/utils/logger.util';
const supportedCurrency=currencyCodeSchema.refine(code=>isCurrency(code)&&new Intl.NumberFormat("en",{style:"currency",currency:code}).resolvedOptions().maximumFractionDigits===2,"Billing requires two decimal places");
const input=z.object({currencyCode:supportedCurrency,previousCurrencyCode:currencyCodeSchema.nullable(),confirm:z.literal(true)}).strict();
export async function getFinancialSettings(req:Request,res:Response){
 const organizationId=req.user?.organizationId;if(!organizationId)return res.status(403).json({success:false,code:'ORGANIZATION_REQUIRED'});
 try{return res.json({success:true,data:{currencyCode:await organizationCurrency(organizationId)}});}catch(error){logger.error('Read financial settings failed',error);return res.status(500).json({success:false,message:'Unable to load financial settings'});}
}
export async function updateFinancialSettings(req:Request,res:Response){
 const actor=req.user;if(!actor?.organizationId||!(['superadmin','subadmin'].includes(actor.role)||(actor.role==='user'&&actor.isOrganizationOwner)))return res.status(403).json({success:false,code:'FORBIDDEN'});
 const parsed=input.safeParse(req.body);if(!parsed.success)return res.status(400).json({success:false,code:'INVALID_CURRENCY',message:'Select a valid currency and confirm the change'});
 try{
  const data=parsed.data;
  const saved=await database.transaction(async tx=>{
   const org=await tx.execute(sql`select settings from organizations where id=${actor.organizationId} for update`);
   if(!org.rows.length)return false;
   const settings=(org.rows[0].settings??{}) as Record<string,unknown>;
   const previous=currencyCodeSchema.safeParse(settings.currency).success?settings.currency:null;
   if(previous!==data.previousCurrencyCode)return false;
   await tx.execute(sql`update organizations set settings=${JSON.stringify({...settings,currency:data.currencyCode})}::json,updated_at=now() where id=${actor.organizationId}`);
   if(previous!==data.currencyCode) await tx.insert(recentActivities).values({organizationId:actor.organizationId,userId:actor.id,actorId:actor.id,type:'organization',action:'updated',resource:'financial-settings',resourceId:actor.organizationId,message:'Organization financial currency updated',metadata:{previousCurrencyCode:previous,currencyCode:data.currencyCode}});
   return true;
  });
  if(!saved)return res.status(409).json({success:false,code:'SETTINGS_CHANGED',message:'Settings changed. Refresh before saving.'});
  return res.json({success:true,data:{currencyCode:data.currencyCode}});
 }catch(error){logger.error('Update financial settings failed',error);return res.status(500).json({success:false,message:'Unable to save financial settings'});}
}

const sources = {
  project: {table: 'projects', label: 'name', amount: 'budget'},
  lead: {table: 'clients', label: 'name', amount: 'lead_value'},
  invoice: {table: 'invoices', label: 'invoice_number', amount: 'amount'},
  recurring: {table: 'recurring_invoices', label: 'template_name', amount: 'amount'},
  paymentLink: {table: 'payment_links', label: 'description', amount: 'amount'},
} as const;
const moneySnapshot = z.string().max(40).regex(/^-?[0-9]+([.][0-9]+)?$/);
const versionSnapshot = z.string().min(1).max(100);
const linkedRevenueSnapshot = z.object({
  id: z.string().min(1).max(100), amount: moneySnapshot,
  currency: z.string().max(100), version: versionSnapshot,
}).strict();
const reconciliationInput = z.object({
  currencyCode: supportedCurrency, confirm: z.literal(true),
  confirmLinkedRevenue: z.literal(true).optional(),
  records: z.array(z.object({
    type: z.enum(['project', 'lead', 'invoice', 'recurring', 'paymentLink']),
    id: z.string().min(1).max(100), amount: moneySnapshot, version: versionSnapshot,
    linkedRevenue: linkedRevenueSnapshot.optional(),
  }).strict()).min(1).max(50),
}).strict();
type ReviewRecord = z.infer<typeof reconciliationInput>['records'][number];
type ConflictReason = 'RECORD_CHANGED' | 'LINKED_RECORD_CHANGED' | 'LINKED_REVENUE_CONFIRMATION_REQUIRED' | 'LINKED_CURRENCY_CONFLICT';
class ReconciliationConflict extends Error {
  constructor(readonly record: Pick<ReviewRecord, 'type' | 'id'>, readonly reason: ConflictReason, readonly currencies: string[] = []) {
    super('RECONCILIATION_CONFLICT');
  }
}
function ownsOrganization(req: Request) {
  const a = req.user;
  return a?.organizationId && (['superadmin', 'subadmin'].includes(a.role) || (a.role === 'user' && a.isOrganizationOwner));
}
export async function unresolvedFinancialCurrencies(req: Request, res: Response) {
  if (!ownsOrganization(req)) return res.status(403).json({success: false, code: 'FORBIDDEN'});
  try {
    const records = [];
    for (const [type, source] of Object.entries(sources)) {
      const linkedRevenue = type === 'invoice' ? sql`(
        select json_build_object('id', r.id, 'amount', r.amount::text, 'version', r.updated_at::text,
          'currency', r.currency, 'canCorrect', r.source='invoice' and invoices.status='paid' and r.amount=invoices.amount
            and r.client_id is not distinct from invoices.client_id and r.project_id is null)
        from revenue_entries r where r.invoice_id=invoices.id and r.organization_id=${req.user!.organizationId}
      )` : sql`null`;
      const linkedCurrencies = type === 'recurring' ? sql`(
        select coalesce(json_agg(r.currency), '[]'::json) from retainers r
        where r.recurring_id=recurring_invoices.id and r.organization_id=${req.user!.organizationId}
      )` : type === 'invoice' ? sql`(
        select coalesce(json_agg(distinct i.currency_code), '[]'::json) from invoice_time_items i
        where i.invoice_id=invoices.id and i.currency_code is not null
      )` : sql`'[]'::json`;
      const rows = await database.execute(sql`
        select id, ${sql.identifier(source.label)} as label, ${sql.identifier(source.amount)}::text as amount,
          updated_at::text as version, ${linkedRevenue} as "linkedRevenue", ${linkedCurrencies} as "linkedCurrencies"
        from ${sql.identifier(source.table)} where organization_id=${req.user!.organizationId}
          and currency_code is null and ${sql.identifier(source.amount)} is not null
        order by updated_at, id limit 50`);
      records.push(...rows.rows.map(row => ({...row, type})));
    }
    return res.json({success: true, data: {records}});
  } catch (error) {
    logger.error('Read unresolved financial currencies failed', error);
    return res.status(500).json({success: false, message: 'Unable to load records'});
  }
}
export async function reconcileFinancialCurrencies(req: Request, res: Response) {
  if (!ownsOrganization(req)) return res.status(403).json({success: false, code: 'FORBIDDEN'});
  const parsed = reconciliationInput.safeParse(req.body);
  if (!parsed.success || parsed.data.records.some(r => r.linkedRevenue && r.type !== 'invoice')) {
    return res.status(400).json({success: false, code: 'INVALID_RECONCILIATION'});
  }
  const {currencyCode, records, confirmLinkedRevenue} = parsed.data;
  if (new Set(records.map(r => r.type + ':' + r.id)).size !== records.length) {
    return res.status(400).json({success: false, code: 'DUPLICATE_RECORD'});
  }
  try {
    await database.transaction(async tx => {
      // Retainer commands lock the contract before its recurring template. Share
      // their organization lock before taking either row lock to avoid inversion.
      if (records.some(record => record.type === 'recurring')) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'time-invoice:' + req.user!.organizationId}, 0))`);
      }
      const revenueCorrections: {id: string; invoiceId: string; amount: string; previousCurrency: string; currency: string}[] = [];
      for (const record of [...records].sort((a, b) => (a.type + ':' + a.id).localeCompare(b.type + ':' + b.id))) {
        const source = sources[record.type];
        // Lock the missing-currency source before its derived ledger entry. A known
        // invoice currency can never be changed through historical reconciliation.
        const current = await tx.execute(sql`
          select id, ${record.type === 'invoice' ? sql`status` : sql`null`} as status,
            ${record.type === 'invoice' ? sql`client_id` : sql`null`} as client_id
          from ${sql.identifier(source.table)} where id=${record.id} and organization_id=${req.user!.organizationId}
            and currency_code is null and updated_at::text=${record.version}
            and ${sql.identifier(source.amount)}::text=${record.amount} for update`);
        if (current.rows.length !== 1) throw new ReconciliationConflict(record, 'RECORD_CHANGED');
        if (record.type === 'invoice') {
          const timeItems = await tx.execute(sql`select currency_code from invoice_time_items
            where invoice_id=${record.id} and currency_code is not null for update`);
          if (timeItems.rows.some(r => r.currency_code !== currencyCode)) {
            throw new ReconciliationConflict(record, 'LINKED_CURRENCY_CONFLICT', timeItems.rows.map(r => String(r.currency_code)));
          }
          const linked = await tx.execute(sql`
            select id, currency, source, client_id, project_id, amount::text as amount, updated_at::text as version
            from revenue_entries where invoice_id=${record.id} and organization_id=${req.user!.organizationId} for update`);
          const revenue = linked.rows[0];
          const reviewed = record.linkedRevenue;
          if (reviewed && (!revenue || ['id', 'currency', 'amount', 'version'].some(key => revenue[key] !== reviewed[key as keyof typeof reviewed]))) {
            throw new ReconciliationConflict(record, 'LINKED_RECORD_CHANGED');
          }
          if (revenue && revenue.currency !== currencyCode) {
            const currencies = [String(revenue.currency)];
            // Old paid invoices generated USD ledger entries regardless of their
            // actual denomination. Correct only this derived entry, after an owner
            // has separately reviewed its current currency, amount and version.
            if (revenue.source !== 'invoice' || current.rows[0].status !== 'paid' || revenue.amount !== record.amount
                || revenue.client_id !== current.rows[0].client_id || revenue.project_id !== null) {
              throw new ReconciliationConflict(record, 'LINKED_CURRENCY_CONFLICT', currencies);
            }
            if (!confirmLinkedRevenue || !reviewed) {
              throw new ReconciliationConflict(record, 'LINKED_REVENUE_CONFIRMATION_REQUIRED', currencies);
            }
            await tx.execute(sql`update revenue_entries set currency=${currencyCode}, updated_at=now()
              where id=${reviewed.id} and organization_id=${req.user!.organizationId} and invoice_id=${record.id}`);
            revenueCorrections.push({id: reviewed.id, invoiceId: record.id, amount: reviewed.amount, previousCurrency: reviewed.currency, currency: currencyCode});
          }
        }
        if (record.type === 'recurring') {
          const linked = await tx.execute(sql`select currency from retainers where recurring_id=${record.id}
            and organization_id=${req.user!.organizationId} for update`);
          if (linked.rows.some(r => r.currency !== currencyCode)) {
            throw new ReconciliationConflict(record, 'LINKED_CURRENCY_CONFLICT', linked.rows.map(r => String(r.currency)));
          }
        }
        await tx.execute(sql`update ${sql.identifier(source.table)} set currency_code=${currencyCode}, updated_at=now()
          where id=${record.id} and organization_id=${req.user!.organizationId}`);
      }
      await tx.insert(recentActivities).values({
        organizationId: req.user!.organizationId, userId: req.user!.id, actorId: req.user!.id,
        type: 'organization', action: 'updated', resource: 'financial-settings', resourceId: req.user!.organizationId,
        message: 'Historical record currencies explicitly confirmed',
        metadata: {currencyCode, records: records.map(({type, id}) => ({type, id})), revenueCorrections},
      });
    });
    return res.json({success: true, data: {updated: records.length}});
  } catch (error) {
    if (error instanceof ReconciliationConflict) {
      return res.status(409).json({success: false, code: 'RECONCILIATION_CONFLICT',
        conflicts: [{type: error.record.type, id: error.record.id, reason: error.reason, currencies: error.currencies}],
        message: 'Review the indicated record and its linked financial entries. No records in this batch were changed.'});
    }
    logger.error('Currency reconciliation failed', error);
    return res.status(500).json({success: false, message: 'Unable to record currencies'});
  }
}
