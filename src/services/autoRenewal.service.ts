import { database } from "../configs/connection.config";
import {
  subscriptions,
  subscriptionPlans,
  organizations,
} from "../schema/schema";
import { eq, and, lte, gte } from "drizzle-orm";
import { logger } from "../utils/logger.util";
import { notifySuperAdmins } from "../utils/superadmin-notification.util";

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
    } catch (error) {
      logger.error("Error during auto-renewal process:", error);
    } finally {
      this.isRunning = false;
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

    // Update subscription
    await database
      .update(subscriptions)
      .set({
        status: "active",
        currentPeriodStart: newPeriodStart,
        currentPeriodEnd: newPeriodEnd,
        updatedAt: now,
        // Update metadata to track renewals
        metadata: {
          ...((subscription.metadata as any) || {}),
          lastRenewedAt: now.toISOString(),
          renewalCount: ((subscription.metadata as any)?.renewalCount || 0) + 1,
        },
      })
      .where(eq(subscriptions.id, subscription.id));

    // Update organization subscription dates and status
    // This ensures super admin subscriptions table shows updated data
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
        "Previous Period End": currentPeriodEnd.toISOString().split("T")[0],
        "New Period Start": newPeriodStart.toISOString().split("T")[0],
        "New Period End": newPeriodEnd.toISOString().split("T")[0],
        "Renewal Date": now.toISOString().split("T")[0],
      },
    }).catch((error) => {
      logger.error("Failed to send auto-renewal notification:", error);
    });
  }

  /**
   * Force renewal check (can be called manually)
   */
  async forceRenewalCheck(): Promise<void> {
    logger.info("Force checking for subscription renewals");
    await this.performAutoRenewal();
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
