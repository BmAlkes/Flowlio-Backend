import { Request, Response } from "express";
import { z } from "zod";
import { trackTime, TimeTrackingError } from "@/services/time-tracking.service";
import { logger } from "@/utils/logger.util";

const startInput = z.object({ requestKey: z.string().uuid().optional() }).strict();
const stopInput = z.object({ timeEntryId: z.string().min(1).max(128) }).strict();
function handler(operation: "start" | "stop") {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const entryId = operation === "start" ? startInput.parse(req.body ?? {}).requestKey : stopInput.parse(req.body ?? {}).timeEntryId;
      const data = await trackTime(req.user, req.params.id, operation, entryId);
      res.status(200).json({ success: true, message: operation === "start" ? "Timer started" : "Timer stopped", data });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ success: false, message: "Refresh the application and select the timer again" });
      } else if (error instanceof TimeTrackingError) {
        res.status(error.status).json({ success: false, message: error.message });
      } else {
        logger.error("Time tracking failed", error);
        res.status(500).json({ success: false, message: "Could not confirm the timer operation. Retry the same action." });
      }
    }
  };
}
export const startTask = handler("start");
export const endTask = handler("stop");
