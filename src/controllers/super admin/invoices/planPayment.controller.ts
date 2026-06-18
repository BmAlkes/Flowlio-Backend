import { Request, Response } from "express";
import axios from "axios";
import { database } from "@/configs/connection.config";
import { organizations, subscriptionPlans, planPaymentRequests } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";
import { getPayPalAccessToken, getPayPalBaseURL } from "@/utils/paypal.util";
import { activatePlanForOrg } from "@/utils/planActivation.util";

// ── helpers ───────────────────────────────────────────────────────────────────

function generateInvoiceNumber(): string {
  return `INV-OD-${Date.now()}`;
}

// ── POST /api/superadmin/invoices/plan-payment ────────────────────────────────

/**
 * Step 1: Superadmin creates a PayPal order for an on-demand plan.
 * Returns approvalUrl to be sent to the client.
 */
export const createPlanPaymentOrder = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const {
      orgId,
      planId,
      amount,
      currency = "USD",
      startDate,
      endDate,
      notes,
      description,
    } = req.body;

    if (!orgId || !planId || !amount || !startDate || !endDate) {
      res.status(400).json({
        success: false,
        message: "orgId, planId, amount, startDate and endDate are required",
      });
      return;
    }

    const amountStr = Number(amount).toFixed(2);

    // Validate org
    const [org] = await database
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) {
      res.status(404).json({ success: false, message: "Organization not found" });
      return;
    }

    // Validate plan
    const [plan] = await database
      .select({ id: subscriptionPlans.id, name: subscriptionPlans.name })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);

    if (!plan) {
      res.status(404).json({ success: false, message: "Plan not found" });
      return;
    }

    const frontendBase = env.FRONTEND_DOMAIN.replace(/\/$/, "");
    const orderDescription =
      description ||
      `Flowlio ${plan.name} — ${org.name}`;

    // Create PayPal order
    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    const paypalRes = await axios.post(
      `${baseURL}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            description: orderDescription,
            custom_id: JSON.stringify({ orgId, planId }),
            amount: { currency_code: currency, value: amountStr },
          },
        ],
        application_context: {
          brand_name: "Flowlio",
          user_action: "PAY_NOW",
          return_url: `${frontendBase}/superadmin/plan-payment/confirm?orgId=${orgId}&planId=${planId}`,
          cancel_url: `${frontendBase}/superadmin/plan-payment/cancel`,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paypalOrderId = paypalRes.data.id as string;
    const approvalUrl = (
      paypalRes.data.links as Array<{ rel: string; href: string }>
    ).find((l) => l.rel === "approve")?.href;

    if (!approvalUrl) {
      logger.error("PayPal did not return approval URL", paypalRes.data);
      res.status(502).json({ success: false, message: "PayPal did not return an approval URL" });
      return;
    }

    // Persist pending request
    const now = new Date();
    const [record] = await database
      .insert(planPaymentRequests)
      .values({
        orgId,
        planId,
        paypalOrderId,
        amount: amountStr,
        currency,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        description: orderDescription,
        notes: notes ?? null,
        invoiceNumber: generateInvoiceNumber(),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: planPaymentRequests.id, invoiceNumber: planPaymentRequests.invoiceNumber });

    logger.info(
      `Plan payment order created: ${paypalOrderId} for org ${org.name} (${orgId}), plan ${plan.name}`
    );

    res.status(201).json({
      success: true,
      data: {
        approvalUrl,
        orderId: paypalOrderId,
        requestId: record.id,
        invoiceNumber: record.invoiceNumber,
        orgName: org.name,
        planName: plan.name,
        amount: amountStr,
        currency,
      },
    });
  } catch (error: any) {
    logger.error("createPlanPaymentOrder error:", error);
    res.status(500).json({ success: false, message: "Failed to create payment order" });
  }
};

// ── POST /api/superadmin/invoices/plan-payment/confirm ───────────────────────

/**
 * Step 2: Called by the frontend after PayPal redirect.
 * Public endpoint — validated by orderId, orgId, planId (no session required).
 */
export const confirmPlanPayment = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { orderId, orgId, planId } = req.body;

    if (!orderId || !orgId || !planId) {
      res.status(400).json({
        success: false,
        message: "orderId, orgId and planId are required",
      });
      return;
    }

    // Find the pending request
    const [record] = await database
      .select()
      .from(planPaymentRequests)
      .where(eq(planPaymentRequests.paypalOrderId, orderId))
      .limit(1);

    if (!record) {
      res.status(404).json({ success: false, message: "Payment request not found" });
      return;
    }

    // Validate orgId + planId match the stored record
    if (record.orgId !== orgId || record.planId !== planId) {
      res.status(400).json({ success: false, message: "Order data mismatch" });
      return;
    }

    // Idempotency: already completed → return success without re-capturing
    if (record.status === "completed") {
      res.status(200).json({
        success: true,
        message: "Payment already processed",
        data: {
          invoiceNumber: record.invoiceNumber,
          amount: record.amount,
          currency: record.currency,
          status: "completed",
        },
      });
      return;
    }

    if (record.status !== "pending") {
      res.status(400).json({
        success: false,
        message: `Cannot confirm payment with status "${record.status}"`,
      });
      return;
    }

    const now = new Date();

    // Capture payment via PayPal
    const accessToken = await getPayPalAccessToken();
    const baseURL = getPayPalBaseURL();

    let captureData: any;
    try {
      const captureRes = await axios.post(
        `${baseURL}/v2/checkout/orders/${orderId}/capture`,
        {},
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      captureData = captureRes.data;
    } catch (captureErr: any) {
      logger.error("PayPal capture failed:", captureErr?.response?.data ?? captureErr.message);

      await database
        .update(planPaymentRequests)
        .set({ status: "failed", updatedAt: now })
        .where(eq(planPaymentRequests.id, record.id));

      res.status(402).json({
        success: false,
        error: "PAYMENT_CAPTURE_FAILED",
        message: "Payment capture failed. The client may need to retry.",
      });
      return;
    }

    if (captureData?.status !== "COMPLETED") {
      await database
        .update(planPaymentRequests)
        .set({ status: "failed", updatedAt: now })
        .where(eq(planPaymentRequests.id, record.id));

      res.status(402).json({
        success: false,
        error: "PAYMENT_CAPTURE_FAILED",
        message: `PayPal status: ${captureData?.status ?? "unknown"}`,
      });
      return;
    }

    // Activate the plan for this org
    const { orgName, planName } = await activatePlanForOrg({
      orgId,
      planId,
      periodStart: new Date(record.startDate),
      periodEnd: new Date(record.endDate),
      notes: record.notes,
      assignedBy: "paypal-ondemand",
    });

    // Mark request as completed
    await database
      .update(planPaymentRequests)
      .set({ status: "completed", updatedAt: now })
      .where(eq(planPaymentRequests.id, record.id));

    logger.info(
      `Plan payment confirmed: ${orderId} — org ${orgName}, plan ${planName}, invoice ${record.invoiceNumber}`
    );

    res.status(200).json({
      success: true,
      message: `Payment confirmed. Plan "${planName}" is now active for "${orgName}".`,
      data: {
        invoiceNumber: record.invoiceNumber,
        orgName,
        planName,
        amount: record.amount,
        currency: record.currency,
        startDate: record.startDate,
        endDate: record.endDate,
      },
    });
  } catch (error: any) {
    logger.error("confirmPlanPayment error:", error);
    res.status(500).json({ success: false, message: "Failed to confirm payment" });
  }
};
