import { exampleHandler } from "@/events/example.event";
import { Socket } from "socket.io";

export const registerEvents = (socket: Socket) => {
  socket.on("example", (params) => exampleHandler({ socket, ...params }));
};
