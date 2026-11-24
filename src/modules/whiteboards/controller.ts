import { Router, type RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { isAuthenticated } from "../../middlewares/auth.middleware";
import { logger } from "../../utils/logger.util";
import { createWhiteboards, WhiteboardError } from "./service";

const service = createWhiteboards(connection);

const handle = (work: (req: Parameters<RequestHandler>[0]) => Promise<unknown>): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ success: true, data: await work(req) });
  } catch (error) {
    if (error instanceof WhiteboardError) {
      res.status(error.status).json({ success: false, code: error.code });
      return;
    }
    logger.error({ error }, "Whiteboard request failed");
    res.status(500).json({ success: false, code: "WHITEBOARD_FAILED" });
  }
};

const fileIds = (value: unknown) => String(value ?? "").split(",").map(id => id.trim()).filter(Boolean).slice(0, 200);

export const whiteboardRoutes = Router();
whiteboardRoutes.use(isAuthenticated);
whiteboardRoutes.get("/", handle(req => service.list(req.user!, req.query)));
whiteboardRoutes.post("/", handle(req => service.create(req.user!, req.body)));
whiteboardRoutes.get("/:id", handle(req => service.get(req.user!, req.params.id)));
whiteboardRoutes.get("/:id/revision", handle(req => service.revision(req.user!, req.params.id)));
whiteboardRoutes.get("/:id/files", handle(req => service.files(req.user!, req.params.id, fileIds(req.query.ids))));
whiteboardRoutes.put("/:id", handle(req => service.save(req.user!, req.params.id, req.body)));
whiteboardRoutes.patch("/:id/project", handle(req => service.move(req.user!, req.params.id, req.body)));
whiteboardRoutes.delete("/:id", handle(req => service.remove(req.user!, req.params.id)));
