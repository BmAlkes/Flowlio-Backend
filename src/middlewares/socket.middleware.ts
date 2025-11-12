import type { NextFunction, Response, Request } from "express";
import type { Socket, ExtendedError } from "socket.io";
import { getSession } from "@/utils/getsession.util";
import { logger } from "@/utils/logger.util";
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
  next: (error?: ExtendedError) => void
) => {
  const sessionId: string | null = socket.handshake.auth.sessionId;
  const session = await getSession(socket.request);

  if (session && sessionId) {
    socket.session = session;
    socket.join(session.user.id);
    logger.info("Socket handshake successfull");
    next();
  } else {
    logger.error("Socket handshake failure");
    next(new Error("Socket handshake failure: missing sessionId"));
  }
};
