import { database } from "../configs/connection.config";
import {
  subscriptions,
  subscriptionPlans,
  organizations,
} from "../schema/schema";
import { eq, and, lte, gte } from "drizzle-orm";
import { logger } from "../utils/logger.util";
import { notifySuperAdmins } from "../utils/superadmin-notification.util";
import { env } from "../utils/env.util";
import axios from "axios";
import { getPayPalAccessToken, getPayPalBaseURL } from "../utils/paypal.util";

const isProduction = process.env.NODE_ENV === "production";
const isRailway =
  process.env.RAILWAY_ENVIRONMENT === "production" ||
  !!process.env.RAILWAY_PROJECT_ID;

export class AutoRenewalService {
  private renewalInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start periodic auto-renewal check
   * @param intervalHours - Check interval in hours (default: 24 hours = once per day)
   */
  startPeriodicRenewal(intervalHours: number = 24): void {
    if (this.renewalInterval) {
      if (!isProduction && !isRailway) {
        logger.warn("Auto-renewal service is already running");
      }
      return;
    }

    logger.info(
      `Starting auto-renewal service (checking every ${intervalHours} hours)`
    );

    // Run immediately on startup, then at intervals
    this.performAutoRenewal().catch((error) => {
      logger.error("Error in initial auto-renewal check:", error);
    });

    this.renewalInterval = setInterval(async () => {
      if (!this.isRunning) {
        await this.performAutoRenewal();
      }
    }, intervalHours * 60 * 60 * 1000);
  }

  /**
   * Stop periodic auto-renewal check
   */
  stopPeriodicRenewal(): void {
    if (this.renewalInterval) {
      clearInterval(this.renewalInterval);
      this.renewalInterval = null;
      logger.info("Auto-renewal service stopped");
    }
  }

  /**
   * Perform auto-renewal for expiring subscriptions
   */
  async performAutoRenewal(): Promise<void> {
    if (this.isRunning) {
      if (!isProduction && !isRailway) {
        logger.warn("Auto-renewal is already running, skipping");
      }
      return;
    }

    this.isRunning = true;
    logger.info("Starting auto-renewal process");

    try {
      const now = new Date();
      // Set time to start of today for accurate date comparison
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000 - 1); // End of today

      // Also check for subscriptions that expired yesterday (in case service didn't run yesterday)
      const yesterdayStart = new Date(
        todayStart.getTime() - 24 * 60 * 60 * 1000
      );

      // Find active subscriptions that expire today OR expired yesterday (missed renewal)
      const expiringSubscriptions = await database
        .select({
          subscription: subscriptions,
          plan: subscriptionPlans,
          organization: organizations,
        })
        .from(subscriptions)
        .innerJoin(
          subscriptionPlans,
          eq(subscriptions.planId, subscriptionPlans.id)
        )
        .innerJoin(
          organizations,
          eq(subscriptions.organizationId, organizations.id)
        )
        .where(
          and(
            eq(subscriptions.status, "active"),
            // Subscription expires today OR expired yesterday (within last 24 hours)
            // This ensures renewal happens on the expiration day
            lte(subscriptions.currentPeriodEnd, todayEnd),
            gte(subscriptions.currentPeriodEnd, yesterdayStart),
            // Not scheduled for cancellation
            eq(subscriptions.cancelAtPeriodEnd, false)
          )
        );

      logger.info(
        `Found ${expiringSubscriptions.length} subscriptions expiring today or expired yesterday`
      );

      const renewalResults = {
        totalSubscriptions: expiringSubscriptions.length,
        successfulRenewals: 0,
        failedRenewals: 0,
        errors: [] as any[],
      };

      // Renew each subscription
      for (const {
        subscription,
        plan,
        organization,
      } of expiringSubscriptions) {
        try {
          await this.renewSubscription(subscription, plan, organization);
          renewalResults.successfulRenewals++;

          // Post-renewal verification: Double-check payment was processed
          // This catches any edge cases where renewal happened without payment
          await this.verifyRenewalPayment(subscription.id, plan, organization);
        } catch (error) {
          renewalResults.failedRenewals++;
          renewalResults.errors.push({
            subscriptionId: subscription.id,
            organizationId: organization.id,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          logger.error(
            `Failed to renew subscription ${subscription.id}:`,
            error
          );
        }
      }

      logger.info("Auto-renewal process completed", renewalResults);
    } catch (error: any) {
      // Check if it's a database connection error
      if (
        error?.message?.includes("ENOTFOUND") ||
        error?.message?.includes("getaddrinfo") ||
        error?.code === "ECONNREFUSED" ||
        error?.code === "ETIMEDOUT"
      ) {
        logger.error(
          "Database connection error during auto-renewal process. " +
            "This is likely a network or database availability issue. " +
            "Auto-renewal will retry on the next scheduled run.",
          {
            error: error.message,
            code: error.code,
            hostname: error?.hostname || "unknown",
          }
        );
      } else {
        logger.error("Error during auto-renewal process:", error);
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Verify PayPal subscription status and return next billing date.
   * For subscriptions using PayPal Subscriptions API, PayPal charges the customer
   * automatically — we just need to sync the status and dates from PayPal's response.
   * Legacy one-time-order subscriptions (pre-subscriptions-API) cannot be auto-renewed
   * and are marked past_due so the customer knows to re-subscribe.
   */
  private async processRenewalPayment(
    plan: typeof subscriptionPlans.$inferSelect,
    subscription: typeof subscriptions.$inferSelect
  ): Promise<{
    success: boolean;
    orderId?: string;
    error?: string;
    nextPeriodEnd?: Date;
  }> {
    try {
      // Free plans never need payment
      const planPrice = Number(plan.price);
      if (!planPrice || planPrice <= 0) {
        return { success: true };
      }

      if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
        logger.warn("PayPal not configured, cannot process renewal payment");
        return { success: false, error: "PayPal not configured" };
      }

      const metadata = (subscription.metadata as any) || {};
      const paypalSubscriptionId: string | undefined =
        metadata.paypalSubscriptionId;
      const paypalOrderId: string | undefined = metadata.paypalOrderId;
      const paypalCaptureId: string | undefined = metadata.paypalCaptureId;

      // ── New flow: subscription created via PayPal Subscriptions API ──────────
      if (paypalSubscriptionId) {
        try {
          const accessToken = await getPayPalAccessToken();
          const baseURL = getPayPalBaseURL();

          const subDetails = await axios.get(
            `${baseURL}/v1/billing/subscriptions/${paypalSubscriptionId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );

          const paypalStatus: string = subDetails.data.status;
          const nextBillingTimeStr: string | undefined =
            subDetails.data.billing_info?.next_billing_time;

          logger.info(
            `PayPal subscription ${paypalSubscriptionId} status: ${paypalStatus}, ` +
              `next billing: ${nextBillingTimeStr ?? "unknown"}`
          );

          if (paypalStatus === "ACTIVE") {
            const nextPeriodEnd = nextBillingTimeStr
              ? new Date(nextBillingTimeStr)
              : undefined;

            return {
              success: true,
              orderId: paypalSubscriptionId,
              nextPeriodEnd,
            };
          }

          // SUSPENDED or CANCELLED — PayPal stopped billing
          logger.warn(
            `PayPal subscription ${paypalSubscriptionId} is ${paypalStatus}. ` +
              `Marking subscription ${subscription.id} as past_due.`
          );
          return {
            success: false,
            error: `PayPal subscription is ${paypalStatus}. Customer must resubscribe.`,
          };
        } catch (apiError: any) {
          logger.error(
            `Failed to verify PayPal subscription ${paypalSubscriptionId}:`,
            apiError
          );
          return {
            success: false,
            error: `PayPal API error during renewal verification: ${apiError.message}`,
          };
        }
      }

      // ── Legacy flow: one-time order (pre-subscriptions-API) ─────────────────
      // These cannot be auto-charged. The customer must re-subscribe using the
      // new PayPal Subscriptions flow to enable true recurring billing.
      if (paypalOrderId || paypalCaptureId) {
        logger.warn(
          `Subscription ${subscription.id} uses legacy one-time PayPal order ` +
            `(orderId=${paypalOrderId}). True auto-billing requires the PayPal ` +
            `Subscriptions API. Marking as past_due so customer re-subscribes.`
        );
        return {
          success: false,
          error: "Legacy one-time order: customer must re-subscribe via PayPal Subscriptions.",
        };
      }

      // No PayPal payment method linked
      logger.warn(
        `Subscription ${subscription.id} has no PayPal payment method linked. ` +
          `Cannot auto-renew without payment. Subscription will be marked as past_due.`
      );

      return {
        success: false,
        error: "No PayPal payment method linked - user must manually renew",
      };
    } catch (error: any) {
      logger.error("Error processing renewal payment:", error);
      return {
        success: false,
        error: error.message || "Payment processing failed",
      };
    }
  }

  /**
   * Renew a single subscription
   */
  private async renewSubscription(
    subscription: typeof subscriptions.$inferSelect,
    plan: typeof subscriptionPlans.$inferSelect,
    organization: typeof organizations.$inferSelect
  ): Promise<void> {
    const now = new Date();
    const currentPeriodEnd = subscription.currentPeriodEnd;

    // Check if payment is required and process it
    const paymentResult = await this.processRenewalPayment(plan, subscription);

    // If payment is required but failed, mark as past_due instead of renewing
    const planPrice = Number(plan.price);
    const requiresPayment = planPrice && planPrice > 0;

    if (requiresPayment && !paymentResult.success) {
      // Payment failed - mark subscription as past_due
      await database
        .update(subscriptions)
        .set({
          status: "past_due",
          updatedAt: now,
          metadata: {
            ...((subscription.metadata as any) || {}),
            lastRenewalAttempt: now.toISOString(),
            renewalFailureReason:
              paymentResult.error || "Payment processing failed",
          },
        })
        .where(eq(subscriptions.id, subscription.id));

      await database
        .update(organizations)
        .set({
          subscriptionStatus: "past_due",
          updatedAt: now,
        })
        .where(eq(organizations.id, organization.id));

      logger.warn(
        `❌ Subscription ${subscription.id} renewal failed - payment required but not processed. Marked as past_due.`,
        {
          subscriptionId: subscription.id,
          organizationId: organization.id,
          organizationName: organization.name,
          planName: plan.name,
          reason: paymentResult.error,
        }
      );

      // Notify super admins about failed renewal
      notifySuperAdmins({
        type: "pendingPayment",
        title: "Subscription Renewal Failed - Payment Required",
        message: `Subscription renewal for "${organization.name}" failed because payment could not be processed automatically.`,
        details: {
          "Organization Name": organization.name || "N/A",
          "Organization ID": organization.id,
          "Plan Name": plan.name || "N/A",
          "Plan Price": `${plan.price} ${plan.currency}`,
          "Expiration Date": currentPeriodEnd.toISOString().split("T")[0],
          "Failure Reason": paymentResult.error || "Payment processing failed",
          "Action Required":
            "User must manually renew subscription by making a payment",
        },
      }).catch((error) => {
        logger.error("Failed to send renewal failure notification:", error);
      });

      // Don't renew - throw error to mark as failed
      throw new Error(
        `Renewal failed: Payment required but could not be processed automatically. ${paymentResult.error}`
      );
    }

    // Calculate new subscription period based on plan's duration
    let renewalPeriodMs = 30 * 24 * 60 * 60 * 1000; // Default: 30 days
    const durationValue = plan.durationValue;
    const durationType = plan.durationType;

    if (durationValue && durationType) {
      const value = Number(durationValue);
      const type = String(durationType).toLowerCase().trim();

      if (!isNaN(value) && value > 0) {
        if (type === "days") {
          renewalPeriodMs = value * 24 * 60 * 60 * 1000;
        } else if (type === "monthly" || type === "month") {
          // Approximate: 30 days per month
          renewalPeriodMs = value * 30 * 24 * 60 * 60 * 1000;
        } else if (type === "yearly" || type === "year") {
          // Approximate: 365 days per year
          renewalPeriodMs = value * 365 * 24 * 60 * 60 * 1000;
        }
      }
    }

    // Calculate new period end date
    // If subscription hasn't expired yet, extend from current end date
    // If subscription has expired, extend from now
    const newPeriodStart = currentPeriodEnd > now ? currentPeriodEnd : now;
    const newPeriodEnd = new Date(newPeriodStart.getTime() + renewalPeriodMs);

    // CRITICAL: Verify payment was actually processed before renewing
    // This catches cases where renewal happens without payment
    const paymentVerified = requiresPayment ? paymentResult.success : true; // Free plans don't need payment

    if (requiresPayment && !paymentResult.success) {
      // This should not happen as we check above, but double-check for safety
      logger.error(
        `⚠️ CRITICAL: Attempted to renew subscription ${subscription.id} without payment verification!`,
        {
          subscriptionId: subscription.id,
          organizationId: organization.id,
          organizationName: organization.name,
          planName: plan.name,
          planPrice: plan.price,
          paymentResult,
        }
      );

      // Mark as payment_pending instead of active
      await database
        .update(subscriptions)
        .set({
          status: "past_due",
          updatedAt: now,
          metadata: {
            ...((subscription.metadata as any) || {}),
            renewalAttemptedAt: now.toISOString(),
            renewalPaymentStatus: "FAILED",
            renewalPaymentError: paymentResult.error || "Payment not processed",
            flaggedForReview: true, // Flag for manual review
          },
        })
        .where(eq(subscriptions.id, subscription.id));

      await database
        .update(organizations)
        .set({
          subscriptionStatus: "past_due",
          updatedAt: now,
        })
        .where(eq(organizations.id, organization.id));

      // Notify super admins about renewal without payment
      notifySuperAdmins({
        type: "pendingPayment",
        title: "⚠️ CRITICAL: Renewal Attempted Without Payment",
        message: `Subscription renewal was attempted for "${organization.name}" but payment was not processed. Account has been marked as past_due.`,
        details: {
          "Organization Name": organization.name || "N/A",
          "Organization ID": organization.id,
          "Plan Name": plan.name || "N/A",
          "Plan Price": `${plan.price} ${plan.currency}`,
          "Subscription ID": subscription.id,
          "Payment Status": "FAILED",
          "Payment Error": paymentResult.error || "Payment not processed",
          "Action Required":
            "URGENT: Review this subscription and ensure payment is collected before reactivating.",
          "Renewal Attempt Date": now.toISOString().split("T")[0],
        },
      }).catch((error) => {
        logger.error("Failed to send critical renewal notification:", error);
      });

      throw new Error(
        `Renewal blocked: Payment verification failed. ${paymentResult.error}`
      );
    }

    // FINAL SAFETY CHECK: Before updating database, verify payment one more time
    // This is the last line of defense to prevent renewal without payment
    if (requiresPayment) {
      // Double-check payment result is actually successful
      if (!paymentResult.success || !paymentVerified) {
        logger.error(
          `🚨 FINAL SAFETY CHECK FAILED: Cannot renew subscription ${subscription.id} - payment verification failed at final check`,
          {
            subscriptionId: subscription.id,
            organizationId: organization.id,
            paymentResult,
            paymentVerified,
          }
        );

        // Mark as past_due
        await database
          .update(subscriptions)
          .set({
            status: "past_due",
            updatedAt: now,
            metadata: {
              ...((subscription.metadata as any) || {}),
              finalSafetyCheckFailed: true,
              finalSafetyCheckFailedAt: now.toISOString(),
              renewalPaymentStatus: "FAILED",
              flaggedForReview: true,
            },
          })
          .where(eq(subscriptions.id, subscription.id));

        await database
          .update(organizations)
          .set({
            subscriptionStatus: "past_due",
            updatedAt: now,
          })
          .where(eq(organizations.id, organization.id));

        // Notify super admins
        notifySuperAdmins({
          type: "pendingPayment",
          title: "🚨 FINAL SAFETY CHECK: Renewal Blocked - No Payment",
          message: `Final safety check blocked renewal for "${organization.name}" - payment verification failed.`,
          details: {
            "Organization Name": organization.name || "N/A",
            "Organization ID": organization.id,
            "Subscription ID": subscription.id,
            "Plan Name": plan.name || "N/A",
            "Plan Price": `${plan.price} ${plan.currency}`,
            Reason: "Final payment verification failed",
          },
        }).catch((error) => {
          logger.error(
            "Failed to send final safety check notification:",
            error
          );
        });

        throw new Error(
          "Final safety check failed: Payment verification required before renewal"
        );
      }
    }

    // Update subscription with payment verification flag
    // Only reach here if payment is verified (or plan is free)
    await database
      .update(subscriptions)
      .set({
        status: "active",
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        updatedAt: now,
        // Update metadata to track renewals and payment status
        metadata: {
          ...((subscription.metadata as any) || {}),
          lastRenewedAt: now.toISOString(),
          renewalCount: ((subscription.metadata as any)?.renewalCount || 0) + 1,
          renewalPaymentProcessed: paymentVerified,
          renewalPaymentStatus: paymentVerified ? "SUCCESS" : "NOT_REQUIRED",
          renewalPaymentMethod: requiresPayment
            ? paymentResult.orderId
              ? "PayPal"
              : "N/A"
            : "FREE_PLAN",
          flaggedForReview: false, // Clear any previous flags
          finalSafetyCheckPassed: true, // Mark that final check passed
          finalSafetyCheckPassedAt: now.toISOString(),
        },
      })
      .where(eq(subscriptions.id, subscription.id));

    // POST-UPDATE VERIFICATION: Immediately verify the update was correct
    // This catches any edge cases where update succeeded but payment wasn't recorded
    const verifyUpdatedSubscription =
      await database.query.subscriptions.findFirst({
        where: (subs, { eq }) => eq(subs.id, subscription.id),
      });

    if (verifyUpdatedSubscription) {
      const verifyMetadata = (verifyUpdatedSubscription.metadata as any) || {};
      const verifyPaymentProcessed = verifyMetadata.renewalPaymentProcessed;
      const verifyPaymentStatus = verifyMetadata.renewalPaymentStatus;

      // If payment was required but not processed, immediately revert
      if (
        requiresPayment &&
        (!verifyPaymentProcessed || verifyPaymentStatus !== "SUCCESS")
      ) {
        logger.error(
          `🚨 POST-UPDATE VERIFICATION FAILED: Subscription ${subscription.id} was updated but payment verification failed! Reverting...`,
          {
            subscriptionId: subscription.id,
            organizationId: organization.id,
            verifyPaymentProcessed,
            verifyPaymentStatus,
          }
        );

        // Revert to past_due
        await database
          .update(subscriptions)
          .set({
            status: "past_due",
            updatedAt: new Date(),
            metadata: {
              ...verifyMetadata,
              postUpdateVerificationFailed: true,
              postUpdateVerificationFailedAt: new Date().toISOString(),
              flaggedForReview: true,
            },
          })
          .where(eq(subscriptions.id, subscription.id));

        await database
          .update(organizations)
          .set({
            subscriptionStatus: "past_due",
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, organization.id));

        // Notify super admins
        notifySuperAdmins({
          type: "pendingPayment",
          title: "🚨 POST-UPDATE VERIFICATION: Renewal Reverted - No Payment",
          message: `Subscription for "${organization.name}" was updated but post-update verification failed. Status reverted to past_due.`,
          details: {
            "Organization Name": organization.name || "N/A",
            "Organization ID": organization.id,
            "Subscription ID": subscription.id,
            "Plan Name": plan.name || "N/A",
            "Plan Price": `${plan.price} ${plan.currency}`,
            Reason: "Post-update payment verification failed",
          },
        }).catch((error) => {
          logger.error(
            "Failed to send post-update verification notification:",
            error
          );
        });

        throw new Error(
          "Post-update verification failed: Payment not properly recorded"
        );
      }
    }

    // Update organization subscription dates and status
    // This ensures super admin subscriptions table shows updated data
    // Only update if subscription update was successful and verified
    await database
      .update(organizations)
      .set({
        subscriptionStatus: "active",
        subscriptionStartDate: newPeriodStart, // Update start date for new period
        subscriptionEndDate: newPeriodEnd, // Update end date for new period
        updatedAt: now,
      })
      .where(eq(organizations.id, organization.id));

    logger.info(
      `✅ Subscription ${subscription.id} auto-renewed for organization ${organization.id}`,
      {
        subscriptionId: subscription.id,
        organizationId: organization.id,
        organizationName: organization.name,
        planName: plan.name,
        oldPeriodEnd: currentPeriodEnd.toISOString(),
        newPeriodStart: newPeriodStart.toISOString(),
        newPeriodEnd: newPeriodEnd.toISOString(),
        renewalPeriodDays: Math.round(renewalPeriodMs / (24 * 60 * 60 * 1000)),
        paymentProcessed: requiresPayment
          ? paymentResult.success
          : "N/A (free plan)",
      }
    );

    // Notify super admins about auto-renewal (non-blocking)
    notifySuperAdmins({
      type: "subscriptionRenewed",
      title: "Subscription Auto-Renewed",
      message: `Subscription for "${organization.name}" has been automatically renewed.`,
      details: {
        "Organization Name": organization.name || "N/A",
        "Organization ID": organization.id,
        "Plan Name": plan.name || "N/A",
        "Plan Price": `${plan.price} ${plan.currency}`,
        "Previous Period End": currentPeriodEnd.toISOString().split("T")[0],
        "New Period Start": newPeriodStart.toISOString().split("T")[0],
        "New Period End": newPeriodEnd.toISOString().split("T")[0],
        "Renewal Date": now.toISOString().split("T")[0],
        "Payment Status": requiresPayment
          ? paymentResult.success
            ? "Processed"
            : "Not Required (Free Plan)"
          : "N/A",
      },
    }).catch((error) => {
      logger.error("Failed to send auto-renewal notification:", error);
    });
  }

  /**
   * Verify that payment was actually processed after renewal
   * This is a safety check to catch any edge cases
   */
  private async verifyRenewalPayment(
    subscriptionId: string,
    plan: typeof subscriptionPlans.$inferSelect,
    organization: typeof organizations.$inferSelect
  ): Promise<void> {
    try {
      // Fetch the updated subscription to verify payment status
      const updatedSubscription = await database.query.subscriptions.findFirst({
        where: (subs, { eq }) => eq(subs.id, subscriptionId),
      });

      if (!updatedSubscription) {
        logger.warn(
          `Could not verify renewal payment: Subscription ${subscriptionId} not found`
        );
        return;
      }

      const metadata = (updatedSubscription.metadata as any) || {};
      const planPrice = Number(plan.price);
      const requiresPayment = planPrice && planPrice > 0;

      // Check if payment was actually processed
      if (requiresPayment) {
        const paymentProcessed = metadata.renewalPaymentProcessed;
        const paymentStatus = metadata.renewalPaymentStatus;

        if (!paymentProcessed || paymentStatus !== "SUCCESS") {
          // CRITICAL: Renewal happened but payment wasn't processed!
          logger.error(
            `🚨 CRITICAL VERIFICATION FAILED: Subscription ${subscriptionId} was renewed but payment was not processed!`,
            {
              subscriptionId,
              organizationId: organization.id,
              organizationName: organization.name,
              planName: plan.name,
              planPrice: plan.price,
              paymentProcessed,
              paymentStatus,
              subscriptionStatus: updatedSubscription.status,
            }
          );

          // Mark subscription as past_due and flag for review
          await database
            .update(subscriptions)
            .set({
              status: "past_due",
              updatedAt: new Date(),
              metadata: {
                ...metadata,
                verificationFailed: true,
                verificationFailedAt: new Date().toISOString(),
                flaggedForReview: true,
              },
            })
            .where(eq(subscriptions.id, subscriptionId));

          await database
            .update(organizations)
            .set({
              subscriptionStatus: "past_due",
              updatedAt: new Date(),
            })
            .where(eq(organizations.id, organization.id));

          // Notify super admins about this critical issue
          notifySuperAdmins({
            type: "pendingPayment",
            title: "🚨 CRITICAL: Renewal Verification Failed - No Payment",
            message: `Subscription for "${organization.name}" was renewed but payment verification failed. Account has been marked as past_due.`,
            details: {
              "Organization Name": organization.name || "N/A",
              "Organization ID": organization.id,
              "Subscription ID": subscriptionId,
              "Plan Name": plan.name || "N/A",
              "Plan Price": `${plan.price} ${plan.currency}`,
              "Payment Status": paymentStatus || "UNKNOWN",
              "Payment Processed": paymentProcessed ? "Yes" : "No",
              "Action Required":
                "URGENT: Review this subscription immediately. Payment must be collected before reactivating.",
              "Verification Date": new Date().toISOString().split("T")[0],
            },
          }).catch((error) => {
            logger.error(
              "Failed to send critical verification notification:",
              error
            );
          });
        } else {
          logger.info(
            `✅ Payment verification passed for subscription ${subscriptionId}`
          );
        }
      }
    } catch (error: any) {
      logger.error(
        `Error verifying renewal payment for subscription ${subscriptionId}:`,
        error
      );
      // Don't throw - this is a verification step, not critical
    }
  }

  /**
   * Force renewal check (can be called manually)
   */
  async forceRenewalCheck(): Promise<void> {
    logger.info("Force checking for subscription renewals");
    await this.performAutoRenewal();
  }

  /**
   * Audit existing subscriptions to find those renewed without payment
   * This function identifies and fixes accounts that were renewed in the past without payment
   */
  async auditSubscriptionsWithoutPayment(): Promise<{
    totalChecked: number;
    foundWithoutPayment: number;
    fixed: number;
    errors: any[];
    report: Array<{
      subscriptionId: string;
      organizationId: string;
      organizationName: string;
      planName: string;
      planPrice: string;
      status: string;
      issue: string;
    }>;
  }> {
    logger.info("Starting audit of subscriptions for payment verification");

    const auditResults = {
      totalChecked: 0,
      foundWithoutPayment: 0,
      fixed: 0,
      errors: [] as any[],
      report: [] as Array<{
        subscriptionId: string;
        organizationId: string;
        organizationName: string;
        planName: string;
        planPrice: string;
        status: string;
        issue: string;
      }>,
    };

    try {
      // Find all active subscriptions with paid plans
      let allActiveSubscriptions;
      try {
        allActiveSubscriptions = await database
          .select({
            subscription: subscriptions,
            plan: subscriptionPlans,
            organization: organizations,
          })
          .from(subscriptions)
          .innerJoin(
            subscriptionPlans,
            eq(subscriptions.planId, subscriptionPlans.id)
          )
          .innerJoin(
            organizations,
            eq(subscriptions.organizationId, organizations.id)
          )
          .where(eq(subscriptions.status, "active"));
      } catch (dbError: any) {
        logger.error("Database error during audit query:", {
          error: dbError.message,
          stack: dbError.stack,
        });
        throw new Error(`Failed to query subscriptions: ${dbError.message}`);
      }

      auditResults.totalChecked = allActiveSubscriptions.length;
      logger.info(
        `Found ${allActiveSubscriptions.length} active subscriptions to audit`
      );

      for (const {
        subscription,
        plan,
        organization,
      } of allActiveSubscriptions) {
        try {
          // Safely handle plan price
          const planPrice = plan.price ? Number(plan.price) : 0;
          const requiresPayment = !isNaN(planPrice) && planPrice > 0;

          // Skip free plans
          if (!requiresPayment) {
            continue;
          }

          // Safely handle metadata
          let metadata: any = {};
          try {
            metadata =
              subscription.metadata && typeof subscription.metadata === "object"
                ? subscription.metadata
                : {};
          } catch (e) {
            logger.warn(
              `Failed to parse metadata for subscription ${subscription.id}`,
              e
            );
            metadata = {};
          }

          const paypalOrderId = metadata?.paypalOrderId;
          const paypalCaptureId = metadata?.paypalCaptureId;
          const paypalSubscriptionId = metadata?.paypalSubscriptionId;
          const renewalPaymentProcessed = metadata?.renewalPaymentProcessed;
          const renewalPaymentStatus = metadata?.renewalPaymentStatus;
          const renewalCount = metadata?.renewalCount || 0;

          // Check if subscription has any payment record
          const hasPaymentRecord =
            paypalOrderId || paypalCaptureId || paypalSubscriptionId;

          // Check if renewal payment was processed
          const hasRenewalPayment =
            renewalPaymentProcessed === true ||
            renewalPaymentStatus === "SUCCESS";

          // If subscription has been renewed (renewalCount > 0) but no payment record
          const issueDetected =
            renewalCount > 0 && !hasPaymentRecord && !hasRenewalPayment;

          if (issueDetected) {
            auditResults.foundWithoutPayment++;

            const issueDescription =
              renewalCount > 0 && !hasPaymentRecord && !hasRenewalPayment
                ? `Renewed ${renewalCount} time(s) but no payment record found`
                : "Active subscription without payment verification";

            auditResults.report.push({
              subscriptionId: subscription.id,
              organizationId: organization.id,
              organizationName: organization.name || "N/A",
              planName: plan.name || "N/A",
              planPrice: `${plan.price || "0"} ${plan.currency || "USD"}`,
              status: subscription.status,
              issue: issueDescription,
            });

            logger.warn(
              `⚠️ Found subscription ${subscription.id} (${organization.name}) renewed without payment`,
              {
                subscriptionId: subscription.id,
                organizationId: organization.id,
                organizationName: organization.name,
                planName: plan.name,
                planPrice: plan.price,
                renewalCount,
                hasPaymentRecord,
                hasRenewalPayment,
              }
            );

            // Mark subscription as past_due and flag for review
            await database
              .update(subscriptions)
              .set({
                status: "past_due",
                updatedAt: new Date(),
                metadata: {
                  ...metadata,
                  auditFlagged: true,
                  auditFlaggedAt: new Date().toISOString(),
                  auditIssue: issueDescription,
                  flaggedForReview: true,
                  requiresManualPayment: true,
                },
              })
              .where(eq(subscriptions.id, subscription.id));

            await database
              .update(organizations)
              .set({
                subscriptionStatus: "past_due",
                updatedAt: new Date(),
              })
              .where(eq(organizations.id, organization.id));

            auditResults.fixed++;

            // Notify super admins about this issue (non-blocking)
            try {
              await notifySuperAdmins({
                type: "pendingPayment",
                title: "⚠️ Audit: Subscription Renewed Without Payment",
                message: `Audit found subscription for "${organization.name}" that was renewed without payment. Account has been marked as past_due.`,
                details: {
                  "Organization Name": organization.name || "N/A",
                  "Organization ID": organization.id,
                  "Subscription ID": subscription.id,
                  "Plan Name": plan.name || "N/A",
                  "Plan Price": `${plan.price || "0"} ${
                    plan.currency || "USD"
                  }`,
                  "Renewal Count": renewalCount.toString(),
                  Issue: issueDescription,
                  "Action Required":
                    "Review this subscription and collect payment before reactivating.",
                  "Audit Date": new Date().toISOString().split("T")[0],
                },
              });
            } catch (notifyError: any) {
              logger.error(
                "Failed to send audit notification (non-blocking):",
                {
                  error: notifyError?.message,
                  subscriptionId: subscription.id,
                }
              );
              // Don't throw - continue with audit
            }
          }
        } catch (error: any) {
          auditResults.errors.push({
            subscriptionId: subscription.id,
            organizationId: organization.id,
            error: error.message || "Unknown error",
          });
          logger.error(
            `Error auditing subscription ${subscription.id}:`,
            error
          );
        }
      }

      logger.info("Subscription audit completed", {
        totalChecked: auditResults.totalChecked,
        foundWithoutPayment: auditResults.foundWithoutPayment,
        fixed: auditResults.fixed,
        errors: auditResults.errors.length,
      });

      // Send summary notification to super admins (non-blocking)
      if (auditResults.foundWithoutPayment > 0) {
        try {
          await notifySuperAdmins({
            type: "pendingPayment",
            title: "📊 Subscription Audit Summary",
            message: `Audit completed: Found ${auditResults.foundWithoutPayment} subscription(s) that were renewed without payment. All have been marked as past_due.`,
            details: {
              "Total Subscriptions Checked":
                auditResults.totalChecked.toString(),
              "Found Without Payment":
                auditResults.foundWithoutPayment.toString(),
              "Fixed (Marked as past_due)": auditResults.fixed.toString(),
              Errors: auditResults.errors.length.toString(),
              "Audit Date": new Date().toISOString().split("T")[0],
            },
          });
        } catch (notifyError: any) {
          logger.error(
            "Failed to send audit summary notification (non-blocking):",
            {
              error: notifyError?.message,
            }
          );
          // Don't throw - continue
        }
      }

      return auditResults;
    } catch (error: any) {
      const errorMessage = error?.message || "Unknown error";
      const errorStack = error?.stack || "No stack trace";
      const errorName = error?.name || "Error";

      logger.error("Error during subscription audit:", {
        message: errorMessage,
        stack: errorStack,
        name: errorName,
      });

      // Log to console for immediate debugging
      console.error("=== AUDIT SERVICE ERROR DETAILS ===");
      console.error("Error Message:", errorMessage);
      console.error("Error Name:", errorName);
      console.error("Error Stack:", errorStack);
      console.error("Full Error Object:", error);
      console.error("===================================");

      auditResults.errors.push({
        error: errorMessage,
        stack: errorStack,
        name: errorName,
      });

      // Still return results even if there was an error
      return auditResults;
    }
  }

  /**
   * Get renewal service status
   */
  getRenewalStatus(): { isRunning: boolean; hasInterval: boolean } {
    return {
      isRunning: this.isRunning,
      hasInterval: this.renewalInterval !== null,
    };
  }
}

// Export singleton instance
export const autoRenewalService = new AutoRenewalService();
