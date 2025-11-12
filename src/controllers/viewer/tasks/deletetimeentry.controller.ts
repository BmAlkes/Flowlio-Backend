import { database } from "@/configs/connection.config";
import { timeEntries } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import status from "http-status";

export const deleteTimeEntry = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params; // time entry id
    const userId = req.user?.id;
    if (!id || !userId) {
      res
        .status(400)
        .json({ success: false, message: "Time entry id and user required" });
      return;
    }

    // Ensure the entry belongs to the user
    const deleted = await database
      .delete(timeEntries)
      .where(and(eq(timeEntries.id, id), eq(timeEntries.userId, userId)))
      .returning({ id: timeEntries.id });

    if (deleted.length === 0) {
      res.status(404).json({ success: false, message: "Time entry not found" });
      return;
    }

    logger.info(`🗑️ Deleted time entry ${id} for viewer user ${userId}`);
    res.status(200).json({ success: true, message: "Time entry deleted" });
  } catch (error) {
    logger.error("Error deleting time entry:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};

