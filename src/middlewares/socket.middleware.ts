import type { NextFunction, Response, Request } from "express";
import type { Socket, ExtendedError } from "socket.io";
import { getSession } from "@/utils/getsession.util";
import { logger } from "@/utils/logger.util";
import { resolveSessionUser } from "@/security/session-access";
import { IO } from "@/types/socket.types";

/**
 * This runs on every request.
 */
export const assignSocketToReqIO = (io: IO) => {
  return (req: Request, _: Response, next: NextFunction) => {
    req.io = io;
    next();
  };
};

/**
 * This runs once per socket connection.
 */
export const connAuthBridge = async (
  socket: Socket,
  next: (error?: ExtendedError) => void,
) => {
  try {
    const session = await getSession(socket.request);
    if (!session || socket.handshake.auth.sessionId !== session.session.id) {
      next(new Error("Socket handshake failure: invalid session"));
      return;
    }
    await resolveSessionUser(session.user.id);
    socket.session = session;
    await socket.join(session.user.id);
    // Recheck idle notification connections as well as HTTP requests.
    let checking = false;
    const interval = setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const current = await getSession(socket.request);
        if (current?.session.id !== session.session.id)
          throw new Error("Session revoked");
        await resolveSessionUser(session.user.id);
      } catch {
        clearInterval(interval);
        socket.disconnect(true);
      } finally {
        checking = false;
      }
    }, 15_000);
    interval.unref();
    socket.once("disconnect", () => clearInterval(interval));
    next();
  } catch (error) {
    logger.warn("Socket authentication denied");
    next(new Error("Socket handshake failure: access denied"));
  }
};
