import cron from "node-cron";
import { automationService } from "./automation.service";
import { RecurringInvoiceService } from "../recurringInvoice.service";
import { logger } from "../../utils/logger.util";

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

  // You can add more schedules here if needed
  // For example, if we wanted to run progress checks more often:
  // cron.schedule('0 */4 * * *', () => { ... });

  logger.info("Cron jobs scheduled.");
};
