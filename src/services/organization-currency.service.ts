import {database} from '@/configs/connection.config';
import {organizations} from '@/schema/schema';
import {eq} from 'drizzle-orm';
import {isCurrency} from '@/utils/financial-currency';
export async function organizationCurrency(organizationId:string):Promise<string|null>{
 const [org]=await database.select({settings:organizations.settings}).from(organizations).where(eq(organizations.id,organizationId));
 return isCurrency(org?.settings?.currency)?org.settings.currency:null;
}
