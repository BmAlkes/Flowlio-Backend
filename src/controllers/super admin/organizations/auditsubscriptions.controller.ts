import { Request, Response } from "express";
import { logger } from "@/utils/logger.util";
import { autoRenewalService } from "@/services/autoRenewal.service";

/**
 * Audit subscriptions to find those renewed without payment
 * GET /api/superadmin/subscriptions/audit
 */
export const auditSubscriptions = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info("Subscription audit requested by super admin");

    // Verify method exists
    if (
      typeof autoRenewalService.auditSubscriptionsWithoutPayment !== "function"
    ) {
      logger.error(
        "auditSubscriptionsWithoutPayment method not found on autoRenewalService"
      );
      console.error(
        "Available methods:",
        Object.getOwnPropertyNames(Object.getPrototypeOf(autoRenewalService))
      );
      res.status(500).json({
        success: false,
        message: "Audit method not available. Please restart the server.",
        error: "Method auditSubscriptionsWithoutPayment not found",
      });
      return;
    }

    const auditResults =
      await autoRenewalService.auditSubscriptionsWithoutPayment();

    res.status(200).json({
      success: true,
      message: "Subscription audit completed successfully",
      data: auditResults,
    });
  } catch (error: any) {
    const errorMessage = error?.message || "Unknown error";
    const errorStack = error?.stack || "No stack trace";
    const errorName = error?.name || "Error";

    logger.error("Error during subscription audit:", {
      message: errorMessage,
      stack: errorStack,
      name: errorName,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    });

    // Log to console for immediate debugging
    console.error("=== AUDIT ERROR DETAILS ===");
    console.error("Error Message:", errorMessage);
    console.error("Error Name:", errorName);
    console.error("Error Stack:", errorStack);
    console.error("Full Error Object:", error);
    console.error("===========================");

    res.status(500).json({
      success: false,
      message: "Failed to audit subscriptions",
      error: process.env.NODE_ENV === "development" ? errorMessage : undefined,
      stack: process.env.NODE_ENV === "development" ? errorStack : undefined,
    });
  }
};
