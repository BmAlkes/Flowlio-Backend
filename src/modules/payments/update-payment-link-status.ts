import { database } from "@/configs/connection.config";
import { paymentLinks } from "@/schema/schema";
import { eq, and } from "drizzle-orm";
import { updatePaymentLinkStatusSchema } from "@/schema/validation";
import type { z } from "zod";

type PaymentLinkStatus = z.infer<typeof updatePaymentLinkStatusSchema>["status"];

/** The organization predicate remains part of the write, not a separate preflight read. */
export async function changePaymentLinkStatus(organizationId: string, id: string, newStatus: PaymentLinkStatus) {
  const [updated] = await database
    .update(paymentLinks)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(paymentLinks.id, id),
        eq(paymentLinks.organizationId, organizationId),
      ),
    )
    .returning();

  return updated;
}
