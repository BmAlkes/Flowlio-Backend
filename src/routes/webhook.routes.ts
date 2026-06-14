import { Router, Request, Response, NextFunction } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { throttle } from "@/middlewares/throttle.middleware";

// Lead webhook management
import { getWebhooks } from "@/controllers/organization/webhooks/getWebhooks.controller";
import { createWebhook } from "@/controllers/organization/webhooks/createWebhook.controller";
import { getWebhook } from "@/controllers/organization/webhooks/getWebhook.controller";
import { updateWebhook } from "@/controllers/organization/webhooks/updateWebhook.controller";
import { deleteWebhook } from "@/controllers/organization/webhooks/deleteWebhook.controller";
import { rotateWebhookToken } from "@/controllers/organization/webhooks/rotateWebhookToken.controller";
import { getWebhookMapping } from "@/controllers/organization/webhooks/getWebhookMapping.controller";
import { updateWebhookMapping } from "@/controllers/organization/webhooks/updateWebhookMapping.controller";
import { getWebhookLogs } from "@/controllers/organization/webhooks/getWebhookLogs.controller";
import { deleteWebhookLog } from "@/controllers/organization/webhooks/deleteWebhookLog.controller";
import { getLeadWebhookLog } from "@/controllers/organization/webhooks/getLeadWebhookLog.controller";
import { testWebhook } from "@/controllers/organization/webhooks/testWebhook.controller";
import { receiveWebhook } from "@/controllers/organization/webhooks/receiveWebhook.controller";

const router = Router();

const auth = [isAuthenticated];
const orgOwner = [isAuthenticated, requireOrgOwnerAccess];

// Parse raw Buffer back to JSON for all management routes
// (global express.raw() in server.ts runs before this router)
const parseBody = (req: Request, _res: Response, next: NextFunction) => {
  if (Buffer.isBuffer(req.body)) {
    try { req.body = JSON.parse(req.body.toString("utf8")); } catch { req.body = {}; }
  }
  next();
};

// ── Public receive endpoint (no auth, open CORS, rate limited) ──
router.post(
  "/receive/:token",
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  throttle({
    keyPrefix: "wh-receive",
    points: 30,
    duration: 60,
    blockDuration: 60,
    errorMessage: "Too many requests to this webhook endpoint",
  }) as any,
  receiveWebhook as any,
);

// ── Authenticated management routes ──
router.use(parseBody);

router.get("/", ...auth, getWebhooks as any);
router.post("/", ...orgOwner, parseBody, createWebhook as any);
router.get("/:id", ...auth, getWebhook as any);
router.patch("/:id", ...orgOwner, updateWebhook as any);
router.delete("/:id", ...orgOwner, deleteWebhook as any);
router.post("/:id/rotate-token", ...orgOwner, rotateWebhookToken as any);
router.get("/:id/mapping", ...auth, getWebhookMapping as any);
router.put("/:id/mapping", ...orgOwner, updateWebhookMapping as any);
router.get("/:id/logs", ...auth, getWebhookLogs as any);
router.delete("/logs/:logId", ...auth, deleteWebhookLog as any);
router.get("/logs/by-lead/:leadId", ...auth, getLeadWebhookLog as any);
router.post("/:id/test", ...orgOwner, testWebhook as any);

export default router;
