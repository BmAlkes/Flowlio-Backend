import { Router, Request, Response, NextFunction } from "express";
import { isAuthenticated } from "@/middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "@/middlewares/role.middleware";
import { requirePlanFeature } from "@/middlewares/plan-feature.middleware";
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
import { retryWebhookLog } from "@/controllers/organization/webhooks/retryWebhook.controller";
import { getLeadWebhookLog } from "@/controllers/organization/webhooks/getLeadWebhookLog.controller";
import { testWebhook } from "@/controllers/organization/webhooks/testWebhook.controller";
import { receiveWebhook } from "@/controllers/organization/webhooks/receiveWebhook.controller";

const router = Router();

// apiAccess guards the entire webhook management panel
const apiManage = [isAuthenticated, requireOrgOwnerAccess, requirePlanFeature("apiAccess")];

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

// Read-only views — require apiAccess so non-plan orgs can't see webhook panel
router.get("/", ...apiManage, getWebhooks as any);
router.get("/:id", ...apiManage, getWebhook as any);
router.get("/:id/mapping", ...apiManage, getWebhookMapping as any);
router.get("/:id/logs", ...apiManage, getWebhookLogs as any);
router.delete("/logs/:logId", ...apiManage, deleteWebhookLog as any);
router.post("/logs/:logId/retry", ...apiManage, retryWebhookLog as any);
router.get("/logs/by-lead/:leadId", ...apiManage, getLeadWebhookLog as any);
// Write / mutate — require apiAccess + orgOwner
router.post("/", ...apiManage, parseBody, createWebhook as any);
router.patch("/:id", ...apiManage, updateWebhook as any);
router.delete("/:id", ...apiManage, deleteWebhook as any);
router.post("/:id/rotate-token", ...apiManage, rotateWebhookToken as any);
router.put("/:id/mapping", ...apiManage, updateWebhookMapping as any);
router.post("/:id/test", ...apiManage, testWebhook as any);

export default router;
