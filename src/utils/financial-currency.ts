import { z } from 'zod';

export function isCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value) &&
    (Intl as typeof Intl & {supportedValuesOf(key:string):string[]}).supportedValuesOf('currency').includes(value);
}
export const currencyCodeSchema = z.string().refine(isCurrency, 'Currency not configured or invalid');
export function proposalCurrency(data: any): string | null {
  const explicit = data?.currencyCode ?? data?.investment?.currencyCode ?? data?.investment?.currency;
  if (explicit != null && explicit !== '') return isCurrency(explicit) ? explicit : null;
  const text: string = typeof data?.investment?.totalBudget === 'string' ? data.investment.totalBudget : '';
  const found = new Set<string>((text.match(/\b[A-Z]{3}\b/g) ?? []).filter(isCurrency));
  if (text.includes('₪')) found.add('ILS');
  if (text.includes('€')) found.add('EUR');
  // A bare dollar sign is ambiguous and never identifies USD.
  return found.size === 1 ? [...found][0] : null;
}
export function invoiceCurrency(value: unknown): string {
  if (!isCurrency(value)) throw new Error('Currency not configured');
  // Existing billing stores integer cents; do not silently round other minor units.
  if (new Intl.NumberFormat('en', {style:'currency',currency:value}).resolvedOptions().maximumFractionDigits !== 2) {
    throw new Error('This billing flow requires a currency with two decimal places');
  }
  return value;
}

export function recordedMoney(value: string | number, currency: unknown): string {
  return isCurrency(currency) ? new Intl.NumberFormat('en', {style:'currency',currency,currencyDisplay:'code'}).format(Number(value)) : 'Currency not recorded';
}
