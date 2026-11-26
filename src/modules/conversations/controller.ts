import { Router, type Request, type RequestHandler } from "express";
import { connection } from "../../configs/connection.config";
import { isAuthenticated } from "../../middlewares/auth.middleware";
import { logger } from "../../utils/logger.util";
import { ConversationError, createConversations, type Emit } from "./service";

const service = createConversations(connection);

// Each signed-in socket joins a room named after its user id (socket.middleware), so events go to people, not to everyone.
const emitter = (req: Request): Emit => (userIds, event, payload) => {
  if (req.io && userIds.length) req.io.to(userIds).emit(event, payload);
};

const handle = (work: (req: Request) => Promise<unknown>): RequestHandler => async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ success: true, data: await work(req) });
  } catch (error) {
    if (error instanceof ConversationError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    logger.error({ error: (error as Error)?.message }, "Conversation request failed");
    res.status(500).json({ success: false, code: "CONVERSATION_FAILED" });
  }
};

export const conversationRoutes = Router();
conversationRoutes.use(isAuthenticated);
conversationRoutes.get("/", handle(req => service.list(req.user!)));
conversationRoutes.post("/context", handle(req => service.forContext(req.user!, req.body)));
conversationRoutes.post("/channels", handle(req => service.createChannel(req.user!, req.body)));
conversationRoutes.post("/direct", handle(req => service.direct(req.user!, req.body)));
conversationRoutes.get("/messages/:messageId/thread", handle(req => service.thread(req.user!, req.params.messageId)));
conversationRoutes.patch("/messages/:messageId", handle(req => service.edit(req.user!, req.params.messageId, req.body, emitter(req))));
conversationRoutes.delete("/messages/:messageId", handle(req => service.remove(req.user!, req.params.messageId, emitter(req))));
conversationRoutes.post("/messages/:messageId/reactions", handle(req => service.react(req.user!, req.params.messageId, req.body, emitter(req))));
conversationRoutes.post("/messages/:messageId/approval", handle(req => service.decide(req.user!, req.params.messageId, req.body, emitter(req))));
conversationRoutes.get("/:id", handle(req => service.open(req.user!, req.params.id)));
conversationRoutes.get("/:id/messages", handle(req => service.page(req.user!, req.params.id, req.query)));
conversationRoutes.post("/:id/messages", handle(req => service.post(req.user!, req.params.id, req.body, emitter(req))));
conversationRoutes.post("/:id/read", handle(req => service.read(req.user!, req.params.id)));
