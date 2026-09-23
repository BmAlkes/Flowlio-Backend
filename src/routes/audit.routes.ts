import { Router, type RequestHandler } from "express";
import { connection } from "../configs/connection.config";
import { isAuthenticated } from "../middlewares/auth.middleware";
import { requireOrgOwnerAccess } from "../middlewares/role.middleware";
import { createAuditRead, AuditReadError } from "../modules/audit/read";
import { logger } from "../utils/logger.util";

const service = createAuditRead(connection);
const router = Router();
const handle = (exporting: boolean): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const result = await service.read(req.user!, req.query, exporting);
    if ("csv" in result) {
      res.attachment("flowlio-audit.csv").type("text/csv; charset=utf-8").send(result.csv);
    } else {
      res.json({ success: true, data: result });
    }
  } catch (error) {
    if (error instanceof AuditReadError) {
      res.status(error.status).json({ success: false, code: error.code });
      return;
    }
    logger.error({ error }, "Audit consultation failed");
    res.status(500).json({ success: false, code: "AUDIT_READ_FAILED" });
  }
};
router.use(isAuthenticated, requireOrgOwnerAccess);
router.get("/", handle(false));
router.get("/export", handle(true));
export default router;
