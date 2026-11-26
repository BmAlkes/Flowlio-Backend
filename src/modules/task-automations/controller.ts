import { Router, type RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { isAuthenticated } from "../../middlewares/auth.middleware";
import { logger } from "../../utils/logger.util";
import { AutomationError, createTaskAutomations } from "./service";

const service = createTaskAutomations(connection);

const handle = (work: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ success: true, data: await work(req) });
  } catch (error) {
    if (error instanceof AutomationError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    logger.error({ error }, "Task automation request failed");
    res.status(500).json({ success: false, code: "AUTOMATION_FAILED" });
  }
};

export const taskAutomationRoutes = Router();
taskAutomationRoutes.use(isAuthenticated);
taskAutomationRoutes.get("/", handle(req => service.list(req.user!)));
taskAutomationRoutes.get("/history", handle(req => service.history(req.user!, req.query.ruleId)));
taskAutomationRoutes.post("/", handle(req => service.save(req.user!, req.body)));
taskAutomationRoutes.put("/:id", handle(req => service.save(req.user!, req.body, req.params.id)));
taskAutomationRoutes.patch("/:id/enabled", handle(req => service.toggle(req.user!, req.params.id, req.body?.enabled)));
taskAutomationRoutes.delete("/:id", handle(req => service.remove(req.user!, req.params.id)));
