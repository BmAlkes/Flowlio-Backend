import { Request, Response } from "express";
import { ZodError } from "zod";
import { Actor } from "@/security/resource-policy";
import { logger } from "@/utils/logger.util";
import { timeBillingFilterSchema, timeInvoiceSchema, TimeInvoicingError } from "@/services/time-invoicing-policy";
import { assertTimeBillingActor, createTimeInvoice, listBillableTime, getInvoiceTimeItems } from "@/services/time-invoicing.service";

type BillingRequest = Request & { user?: Actor };
function failure(res: Response, error: unknown) {
  if (error instanceof ZodError) { res.status(400).json({ success: false, code: "INVALID_INPUT", message: "Check the selected dates, entries and rate.", errors: error.issues }); return; }
  if (error instanceof TimeInvoicingError) { res.status(error.status).json({ success: false, code: error.code, message: error.message }); return; }
  logger.error("Time invoicing failed", error);
  res.status(500).json({ success: false, code: "TIME_INVOICING_FAILED", message: "Could not complete the request. Retry with the same selection." });
}
export async function billableTime(req: BillingRequest, res: Response): Promise<void> {
  try { assertTimeBillingActor(req.user); res.json({ success: true, data: await listBillableTime(req.user, timeBillingFilterSchema.parse(req.query)) }); }
  catch (error) { failure(res, error); }
}
export async function invoiceFromTime(req: BillingRequest, res: Response): Promise<void> {
  try {
    assertTimeBillingActor(req.user);
    const result = await createTimeInvoice(req.user, timeInvoiceSchema.parse(req.body));
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result.invoice, replayed: result.replayed });
  } catch (error) { failure(res, error); }
}
export async function invoiceTimeDetails(req: BillingRequest, res: Response): Promise<void> {
  try { assertTimeBillingActor(req.user); res.json({ success: true, data: await getInvoiceTimeItems(req.user, req.params.id) }); }
  catch (error) { failure(res, error); }
}
