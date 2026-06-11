import { Router, Request, Response } from "express";
import express from "express";
import { validateWebhookSignature } from "@/middlewares/webhook-signature.middleware";

const router = Router();

// Apply raw body parser to ALL routes in this router BEFORE any routes
// This must NOT affect global express.json() middleware
router.use(express.raw({ type: "application/json" }));

router.post(
  "/test",
  validateWebhookSignature,
  (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      message: "Webhook signature valid",
      orgId: (req as any).webhookOrgId,
    });
  }
);

export default router;
