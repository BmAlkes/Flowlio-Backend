import { Router, type RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { isAuthenticated } from "../../middlewares/auth.middleware";
import { logger } from "../../utils/logger.util";
import { ImportError } from "../organization-data/import";
import { MondayError } from "./client";
import { createMondayImport } from "./service";

const service = createMondayImport(connection);

// The request body carries the person's monday.com token: it is never logged or stored.
const handle = (work: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ success: true, data: await work(req) });
  } catch (error) {
    if (error instanceof MondayError || error instanceof ImportError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    logger.error({ error: (error as Error)?.message }, "monday.com import failed");
    res.status(500).json({ success: false, code: "MONDAY_IMPORT_FAILED" });
  }
};

export const mondayRoutes = Router();
mondayRoutes.use(isAuthenticated);
mondayRoutes.post("/boards", handle(req => service.boards(req.user!, req.body)));
mondayRoutes.post("/import", handle(req => service.importBoard(req.user!, req.body)));
