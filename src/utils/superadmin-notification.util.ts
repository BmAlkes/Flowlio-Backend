import { database } from "@/configs/connection.config";
import { users, notifications } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.util";
import { sendEmail } from "@/configs/brevo.config";
import crypto from "crypto";

interface NotificationData {
  type:
    | "userSubscribe"
    | "newCompany"
    | "projectCompletion"
    | "newUserSignup"
    | "pendingPayment"
    | "userUnsubscribe"
    | "planUpgrade"
    | "subscriptionRenewed";
  title: string;
  message: string;
  details?: Record<string, any>;
}

/**
 * Get all super admins with notification preferences enabled for the given type
 */
export const getSuperAdminsForNotification = async (
  notificationType:
    | "userSubscribeNotifications"
    | "newCompanyNotifications"
    | "projectCompletionNotifications"
    | "newUserSignupNotifications"
    | "pendingPaymentNotifications"
    | "userUnsubscribeNotifications"
    | "planUpgradeNotifications"
    | "subscriptionRenewedNotifications"
) => {
  try {
    const allSuperAdmins = await database.query.users.findMany({
      where: eq(users.isSuperAdmin, true),
      columns: {
        id: true,
        email: true,
        name: true,
        notificationPreferences: true,
      },
    });

    // Filter super admins who have this notification type enabled
    const enabledSuperAdmins = allSuperAdmins.filter((admin) => {
      const prefs = admin.notificationPreferences as any;
      // Default to true if not set
      return prefs?.[notificationType] !== false;
    });

    logger.info(
      `Found ${enabledSuperAdmins.length} super admins with ${notificationType} enabled`
    );

    return enabledSuperAdmins;
  } catch (error) {
    logger.error("Error fetching super admins for notification:", error);
    return [];
  }
};

/**
 * Send notification to super admins based on their preferences
 */
export const notifySuperAdmins = async (data: NotificationData) => {
  try {
    const notificationTypeMap: Record<
      string,
      | "userSubscribeNotifications"
      | "newCompanyNotifications"
      | "projectCompletionNotifications"
      | "newUserSignupNotifications"
      | "pendingPaymentNotifications"
      | "userUnsubscribeNotifications"
      | "planUpgradeNotifications"
      | "subscriptionRenewedNotifications"
    > = {
      userSubscribe: "userSubscribeNotifications",
      newCompany: "newCompanyNotifications",
      projectCompletion: "projectCompletionNotifications",
      newUserSignup: "newUserSignupNotifications",
      pendingPayment: "pendingPaymentNotifications",
      userUnsubscribe: "userUnsubscribeNotifications",
      planUpgrade: "planUpgradeNotifications",
      subscriptionRenewed: "subscriptionRenewedNotifications",
    };

    const notificationKey = notificationTypeMap[data.type];
    if (!notificationKey) {
      logger.warn(`Unknown notification type: ${data.type}`);
      return;
    }

    const superAdmins = await getSuperAdminsForNotification(notificationKey);

    if (superAdmins.length === 0) {
      logger.info(`No super admins have ${notificationKey} enabled`);
      return;
    }

    // Send email notifications to all enabled super admins
    const emailPromises = superAdmins.map(async (admin) => {
      try {
        const emailHtml = `
          <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
            <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h2 style="margin: 0; color: #1a202c;">${data.title}</h2>
              </div>
              <p style="font-size: 16px; color: #333;">
                ${data.message}
              </p>
              ${
                data.details
                  ? `
              <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #1a202c; font-size: 14px;">Details:</h3>
                ${Object.entries(data.details)
                  .map(
                    ([key, value]) =>
                      `<p style="margin: 8px 0; font-size: 14px; color: #555;"><strong>${key}:</strong> ${value}</p>`
                  )
                  .join("")}
              </div>
              `
                  : ""
              }
              <p style="font-size: 14px; color: #888; margin-top: 24px;">
                This is an automated notification from Flowlio.
              </p>
            </div>
          </div>
        `;

        await sendEmail({
          subject: `Flowlio: ${data.title}`,
          htmlContent: emailHtml,
          sender: {
            email: "noreply@flowlio.com",
            name: "Flowlio",
          },
          to: [
            {
              email: admin.email,
              name: admin.name || "Super Admin",
            },
          ],
        });

        logger.info(`Notification sent to super admin: ${admin.email}`);
      } catch (error) {
        logger.error(
          `Failed to send notification to super admin ${admin.email}:`,
          error
        );
      }
    });

    await Promise.allSettled(emailPromises);

    // Also create in-app database notifications for super admins
    const notificationPromises = superAdmins.map(async (admin) => {
      try {
        const notificationId = crypto.randomUUID().replace(/-/g, "");
        const typeMap: Record<string, string> = {
          userSubscribe: "user_subscribed",
          newCompany: "new_company_registered",
          projectCompletion: "project_completed",
          newUserSignup: "new_user_signed_up",
          pendingPayment: "pending_payment",
          userUnsubscribe: "user_unsubscribed",
          planUpgrade: "plan_upgraded",
          subscriptionRenewed: "subscription_renewed",
        };

        await database.insert(notifications).values({
          id: notificationId,
          userId: admin.id,
          type: typeMap[data.type] || "system",
          title: data.title,
          message: data.message,
          data: data.details || {},
          read: false,
          createdAt: new Date(),
        });
        logger.info(`In-app notification created for super admin: ${admin.id}`);
      } catch (error) {
        logger.error(
          `Failed to create in-app notification for super admin ${admin.id}:`,
          error
        );
      }
    });

    await Promise.allSettled(notificationPromises);

    logger.info(
      `Notification process completed for ${data.type} event. Sent emails and created in-app notifications for ${superAdmins.length} super admins.`
    );
  } catch (error) {
    logger.error("Error notifying super admins:", error);
  }
};
