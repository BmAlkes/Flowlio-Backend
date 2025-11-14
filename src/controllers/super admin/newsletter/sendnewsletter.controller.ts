import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { newsletterSubscribers } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { env } from "@/utils/env.util";
import status from "http-status";

// Helper function to ensure URL has protocol
const getBaseURL = (domain: string) => {
  const isProduction = process.env.NODE_ENV === "production";
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }
  return isProduction ? `https://${domain}` : `http://${domain}`;
};

// Logo URL - ensure protocol is included for email clients
const logo = getBaseURL(env.BACKEND_DOMAIN) + "/logowithtext.png";

// Newsletter template function - defined directly in controller to avoid import issues
function newsletterTemplate({
  subject,
  content,
  unsubscribeUrl,
}: {
  subject: string;
  content: string;
  unsubscribeUrl?: string;
}): string {
  return `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">${subject}</h2>
      </div>
      <div style="font-size: 16px; color: #333; line-height: 1.6;">
        ${content.replace(/\n/g, "<br>")}
      </div>
      ${
        unsubscribeUrl
          ? `
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 12px; color: #888; text-align: center;">
        <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">Unsubscribe from this newsletter</a>
      </p>
      `
          : ""
      }
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;
}

export const sendNewsletter = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { subject, content } = req.body;

    // Validate input
    if (
      !subject ||
      typeof subject !== "string" ||
      subject.trim().length === 0
    ) {
      res.status(400).json({
        success: false,
        message: "Subject is required",
      });
      return;
    }

    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      res.status(400).json({
        success: false,
        message: "Content is required",
      });
      return;
    }

    // Get all subscribed users
    const subscribedUsers = await database
      .select()
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.subscribed, true));

    if (subscribedUsers.length === 0) {
      res.status(404).json({
        success: false,
        message: "No subscribed users found",
      });
      return;
    }

    // Validate sender email
    if (!env.BREVO_SENDER) {
      res.status(500).json({
        success: false,
        message:
          "Email sender not configured. Please set BREVO_SENDER in environment variables.",
      });
      return;
    }

    // Get frontend URL for unsubscribe link
    const frontendUrl = env.FRONTEND_DOMAIN || "http://localhost:4000";
    const unsubscribeBaseUrl = `${frontendUrl}/unsubscribe`;

    // Send emails to all subscribed users
    const emailPromises = subscribedUsers.map(async (subscriber) => {
      try {
        const unsubscribeUrl = `${unsubscribeBaseUrl}?email=${encodeURIComponent(
          subscriber.email
        )}`;

        const emailContent = newsletterTemplate({
          subject: subject.trim(),
          content: content.trim(),
          unsubscribeUrl,
        });

        const emailPayload = {
          to: [
            {
              email: subscriber.email,
              name: subscriber.email.substring(
                0,
                subscriber.email.lastIndexOf("@")
              ),
            },
          ],
          subject: subject.trim(),
          htmlContent: emailContent,
          sender: {
            name: "Flowlio",
            email: env.BREVO_SENDER,
          },
        };

        logger.info(
          `Attempting to send newsletter to ${subscriber.email} with sender ${env.BREVO_SENDER}`
        );

        const brevoResponse = await brevoTransactionApi.sendTransacEmail(
          emailPayload
        );

        // // Log full response for debugging
        // console.log(
        //   `[Newsletter] Full Brevo API response for ${subscriber.email}:`,
        //   JSON.stringify(brevoResponse, null, 2)
        // );

        const statusCode = brevoResponse?.response?.statusCode || brevoResponse;
        const messageId = brevoResponse?.body?.messageId || brevoResponse;
        const responseBody = brevoResponse?.body || brevoResponse;

        console.log(
          `[Newsletter] Brevo API response summary for ${subscriber.email}:`,
          {
            statusCode,
            messageId,
            body: responseBody,
            hasMessageId: !!messageId,
          }
        );

        // Check if email was actually accepted by Brevo
        // Brevo typically returns 201 for successful sends with a messageId
        if (statusCode !== 201 && statusCode !== 200) {
          const errorMsg = `Brevo API returned status ${statusCode} instead of 201/200`;
          console.error(`[Newsletter] ${errorMsg} for ${subscriber.email}`);
          logger.error(
            `Newsletter send failed for ${subscriber.email}: ${errorMsg}`
          );
          return {
            email: subscriber.email,
            success: false,
            error: errorMsg,
            statusCode,
          };
        }

        // Check if we got a messageId (indicates email was accepted)
        if (!messageId) {
          const errorMsg =
            "No messageId in Brevo response - email may not have been sent";
          console.error(`[Newsletter] ${errorMsg} for ${subscriber.email}`);
          logger.error(
            `Newsletter send failed for ${subscriber.email}: ${errorMsg}`
          );
          return {
            email: subscriber.email,
            success: false,
            error: errorMsg,
            responseBody,
          };
        }

        logger.info(`Newsletter sent successfully to: ${subscriber.email}`, {
          messageId,
          statusCode,
        });

        return {
          email: subscriber.email,
          success: true,
          messageId,
        };
      } catch (error: any) {
        // Log the entire error object first to see its structure
        // Use console.error as well to ensure we see the error
        console.error(
          `[Newsletter Error] Raw error for ${subscriber.email}:`,
          error
        );
        console.error(
          `[Newsletter Error] Error type:`,
          error?.constructor?.name
        );
        console.error(`[Newsletter Error] Error message:`, error?.message);
        console.error(`[Newsletter Error] Error code:`, error?.code);
        console.error(
          `[Newsletter Error] Error statusCode:`,
          error?.statusCode
        );
        console.error(`[Newsletter Error] Error response:`, error?.response);
        console.error(`[Newsletter Error] Error body:`, error?.body);
        console.error(`[Newsletter Error] Error stack:`, error?.stack);

        try {
          logger.error(`Raw error object for ${subscriber.email}:`, {
            errorType: error?.constructor?.name,
            message: error?.message,
            stack: error?.stack,
            code: error?.code,
            statusCode: error?.statusCode || error?.response?.statusCode,
            response: error?.response,
            body: error?.body,
            keys: Object.keys(error || {}),
            stringified: JSON.stringify(
              error,
              Object.getOwnPropertyNames(error)
            ),
          });
        } catch (logError) {
          console.error(`[Newsletter Error] Failed to log error:`, logError);
          logger.error(
            `Error logging failed for ${subscriber.email}, error:`,
            String(error)
          );
        }

        // Extract error message from Brevo API response
        let errorMessage = "Unknown error";

        // Try to get error message from various possible locations
        if (error instanceof Error) {
          errorMessage = error.message || "Error instance without message";
        } else if (typeof error === "string") {
          errorMessage = error;
        } else if (error?.response) {
          // Axios-like error structure
          const response = error.response;
          if (response?.data) {
            if (typeof response.data === "string") {
              try {
                const parsed = JSON.parse(response.data);
                errorMessage = parsed.message || parsed.error || response.data;
              } catch {
                errorMessage = response.data;
              }
            } else if (response.data?.message) {
              errorMessage = response.data.message;
            } else {
              errorMessage = JSON.stringify(response.data);
            }
          } else if (response?.body) {
            if (typeof response.body === "string") {
              try {
                const parsed = JSON.parse(response.body);
                errorMessage = parsed.message || parsed.error || response.body;
              } catch {
                errorMessage = response.body;
              }
            } else if (response.body?.message) {
              errorMessage = response.body.message;
            } else {
              errorMessage = JSON.stringify(response.body);
            }
          } else {
            errorMessage = `HTTP ${
              response?.status || response?.statusCode || "Unknown"
            } error`;
          }
        } else if (error?.body) {
          errorMessage =
            typeof error.body === "string"
              ? error.body
              : error.body?.message || JSON.stringify(error.body);
        } else if (error?.message) {
          errorMessage = error.message;
        } else {
          // Last resort: stringify the whole error
          try {
            errorMessage = JSON.stringify(error);
          } catch {
            errorMessage = String(error);
          }
        }

        const errorDetails = {
          message: errorMessage,
          code: error?.code,
          statusCode:
            error?.statusCode ||
            error?.response?.statusCode ||
            error?.response?.status,
          response:
            error?.response?.data || error?.response?.body || error?.body,
          errorType: error?.constructor?.name,
          fullError: error,
        };

        logger.error(
          `Failed to send newsletter to ${subscriber.email}:`,
          errorDetails
        );

        return {
          email: subscriber.email,
          success: false,
          error: errorMessage,
        };
      }
    });

    // Wait for all emails to be sent
    const results = await Promise.allSettled(emailPromises);

    const successful = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failed = results.length - successful;

    logger.info(
      `Newsletter sent: ${successful} successful, ${failed} failed out of ${subscribedUsers.length} subscribers`
    );

    res.status(200).json({
      success: true,
      message: `Newsletter sent to ${successful} subscribers${
        failed > 0 ? ` (${failed} failed)` : ""
      }`,
      data: {
        total: subscribedUsers.length,
        successful,
        failed,
        results: results.map((r) =>
          r.status === "fulfilled"
            ? r.value
            : { success: false, error: "Promise rejected" }
        ),
      },
    });
  } catch (error) {
    logger.error("Error sending newsletter:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to send newsletter",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
