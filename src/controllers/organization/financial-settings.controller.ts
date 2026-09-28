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
 project:{table:'projects',label:'name',amount:'budget'},
 lead:{table:'clients',label:'name',amount:'lead_value'},
 invoice:{table:'invoices',label:'invoice_number',amount:'amount'},
 recurring:{table:'recurring_invoices',label:'template_name',amount:'amount'},
 paymentLink:{table:'payment_links',label:'description',amount:'amount'},
} as const;
const reconciliationInput=z.object({currencyCode:supportedCurrency,confirm:z.literal(true),records:z.array(z.object({type:z.enum(['project','lead','invoice','recurring','paymentLink']),id:z.string().min(1).max(100),amount:z.string().max(40).regex(/^-?[0-9]+([.][0-9]+)?$/),version:z.string().min(1).max(100)}).strict()).min(1).max(50)}).strict();
function ownsOrganization(req:Request){const a=req.user;return a?.organizationId&&(['superadmin','subadmin'].includes(a.role)||(a.role==='user'&&a.isOrganizationOwner));}
export async function unresolvedFinancialCurrencies(req:Request,res:Response){
 if(!ownsOrganization(req))return res.status(403).json({success:false,code:'FORBIDDEN'});
 try{
  const records=[];
  for(const [type,source]of Object.entries(sources)){
   const rows=await database.execute(sql`select id,${sql.identifier(source.label)} as label,${sql.identifier(source.amount)}::text as amount,updated_at::text as version from ${sql.identifier(source.table)} where organization_id=${req.user!.organizationId} and currency_code is null and ${sql.identifier(source.amount)} is not null order by updated_at,id limit 50`);
   records.push(...rows.rows.map(row=>({...row,type})));
  }
  return res.json({success:true,data:{records}});
 }catch(error){logger.error('Read unresolved financial currencies failed',error);return res.status(500).json({success:false,message:'Unable to load records'});}
}
export async function reconcileFinancialCurrencies(req:Request,res:Response){
 if(!ownsOrganization(req))return res.status(403).json({success:false,code:'FORBIDDEN'});
 const parsed=reconciliationInput.safeParse(req.body);if(!parsed.success)return res.status(400).json({success:false,code:'INVALID_RECONCILIATION'});
 const {currencyCode,records}=parsed.data;
 if(new Set(records.map(r=>r.type+':'+r.id)).size!==records.length)return res.status(400).json({success:false,code:'DUPLICATE_RECORD'});
 try{
  await database.transaction(async tx=>{
   for(const record of [...records].sort((a,b)=>(a.type+':'+a.id).localeCompare(b.type+':'+b.id))){
    const source=sources[record.type];
    if(record.type==='invoice'){
     const conflict=await tx.execute(sql`select 1 from revenue_entries where invoice_id=${record.id} and organization_id=${req.user!.organizationId} and currency is distinct from ${currencyCode} limit 1`);
     if(conflict.rows.length)throw new Error('RECONCILIATION_CONFLICT');
    }
    if(record.type==='recurring'){
     const conflict=await tx.execute(sql`select 1 from retainers where recurring_id=${record.id} and organization_id=${req.user!.organizationId} and currency is distinct from ${currencyCode} limit 1`);
     if(conflict.rows.length)throw new Error('RECONCILIATION_CONFLICT');
    }
    const rows=await tx.execute(sql`update ${sql.identifier(source.table)} set currency_code=${currencyCode},updated_at=now() where id=${record.id} and organization_id=${req.user!.organizationId} and currency_code is null and updated_at::text=${record.version} and ${sql.identifier(source.amount)}::text=${record.amount} returning id`);
    if(rows.rows.length!==1)throw new Error('RECONCILIATION_CONFLICT');
   }
   await tx.insert(recentActivities).values({organizationId:req.user!.organizationId,userId:req.user!.id,actorId:req.user!.id,type:'organization',action:'updated',resource:'financial-settings',resourceId:req.user!.organizationId,message:'Historical record currencies explicitly confirmed',metadata:{currencyCode,records:records.map(({type,id})=>({type,id}))}});
  });
  return res.json({success:true,data:{updated:records.length}});
 }catch(error){if(error instanceof Error&&error.message==='RECONCILIATION_CONFLICT')return res.status(409).json({success:false,code:'RECONCILIATION_CONFLICT',message:'A record changed or is unavailable. Refresh and review again.'});logger.error('Currency reconciliation failed',error);return res.status(500).json({success:false,message:'Unable to record currencies'});}
}
