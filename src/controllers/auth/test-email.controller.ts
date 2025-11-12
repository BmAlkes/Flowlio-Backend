import { Request, Response } from "express";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { env } from "@/utils/env.util";
import { logger } from "@/utils/logger.util";
import status from "http-status";

export const testEmailService = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const user = req.user;
    if (!user || !user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    logger.info(`🧪 Testing email service for user ${user.email}`);

    // Test email configuration
    logger.info(`📧 Brevo API Key configured: ${!!env.BREVO_API_KEY}`);
    logger.info(`📧 Brevo Sender: ${env.BREVO_SENDER}`);
    logger.info(`📧 Frontend Domain: ${env.FRONTEND_DOMAIN}`);

    // Send a test email
    const testOTP = "123456";
    await brevoTransactionApi.sendTransacEmail({
      to: [{ email: user.email, name: user.name }],
      subject: "Test 2FA OTP - Flowlio",
      htmlContent: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333; margin-bottom: 10px;">Test Email Service</h1>
            <p style="color: #666; font-size: 16px;">This is a test email to verify email service is working</p>
          </div>
          
          <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; text-align: center; margin: 20px 0;">
            <p style="color: #333; font-size: 18px; margin-bottom: 15px;">Test OTP Code:</p>
            <div style="background-color: #fff; border: 2px dashed #007bff; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007bff; font-family: monospace;">${testOTP}</span>
            </div>
            <p style="color: #666; font-size: 14px;">This is just a test - not a real OTP.</p>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px; margin: 0;">
              Flowlio Email Service Test
            </p>
          </div>
        </div>
      `,
      sender: {
        name: "Flowlio Test",
        email: env.BREVO_SENDER,
      },
    });

    logger.info(`✅ Test email sent successfully to ${user.email}`);

    res.status(200).json({
      success: true,
      message: "Test email sent successfully",
      data: {
        email: user.email,
        testOTP: testOTP,
        brevoConfigured: !!env.BREVO_API_KEY,
        sender: env.BREVO_SENDER,
      },
    });
  } catch (error) {
    logger.error("Error testing email service:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to send test email",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
