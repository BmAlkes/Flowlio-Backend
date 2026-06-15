import cron from "node-cron";
import { automationService } from "./automation.service";
import { RecurringInvoiceService } from "../recurringInvoice.service";
import { logger } from "../../utils/logger.util";
import { database } from "../../configs/connection.config";
import { aiTokenLimits } from "../../schema/schema";
import { and, eq, lte } from "drizzle-orm";
import { nextMonthReset } from "../../utils/aiTokenLimit.util";

/**
 * Initializes and starts all backend cron jobs
 */
export const initCronJobs = () => {
  logger.info("Initializing scheduled automation jobs...");

  // Daily Cron Job (Running every 5 minutes in dev for testing, but typically daily)
  cron.schedule("*/5 * * * *", async () => {
    logger.info("Running scheduled automation tasks...");

    try {
      // A) Overdue Task Automation
      await automationService.handleOverdueTasks();

      // B) Project End Date Reminder
      await automationService.handleProjectEndReminders();

      // C) Recurring Invoice Processing
      await RecurringInvoiceService.processRecurringInvoices();

      logger.info("Scheduled automation tasks completed successfully.");
    } catch (error) {
      logger.error("Error running scheduled automation tasks:", error);
    }
  });

  // Daily AI token reset: resets tokensUsed for orgs whose monthly period has expired
  cron.schedule("0 0 * * *", async () => {
    try {
      const now = new Date();
      await database
        .update(aiTokenLimits)
        .set({
          tokensUsed: 0,
          resetAt: nextMonthReset(),
          updatedAt: now,
        })
        .where(
          and(
            eq(aiTokenLimits.isActive, true),
            lte(aiTokenLimits.resetAt, now)
          )
        );
      logger.info("AI token monthly reset completed.");
    } catch (error) {
      logger.error("Error resetting AI token usage:", error);
    }
  });

  logger.info("Cron jobs scheduled.");
};
