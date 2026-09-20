import crypto from "node:crypto";
import { enqueue } from "./jobs/queue";
import { database, connection } from "../configs/connection.config";
import {
  subscriptions,
  subscriptionPlans,
  organizations,
} from "../schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.util";
import { notifySuperAdmins } from "../utils/superadmin-notification.util";
export class AutoRenewalService {
  async performAutoRenewal(_strict = false): Promise<void> {
    await enqueue(connection, "subscription-renewal", "manual-renewal:" + crypto.randomUUID());
  }

  async forceRenewalCheck(): Promise<void> { await this.performAutoRenewal(); }

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


}

// Export singleton instance
export const autoRenewalService = new AutoRenewalService();
