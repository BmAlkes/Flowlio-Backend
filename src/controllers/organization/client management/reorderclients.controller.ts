import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { requireOrganizationId } from "@/utils/organization.util";
import { reorderClientsSchema } from "../../../schema/validation";

export const reorderClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const validatedData = reorderClientsSchema.parse(req.body);
    const { updates } = validatedData;
    const organizationId = requireOrganizationId(req as any, res);
    
    if (!organizationId) return;

    if (!Array.isArray(updates) || updates.length === 0) {
      res.status(400).json({
        success: false,
        error: "Invalid updates array",
      });
      return;
    }

    const results = await database.transaction(async (tx) => {
      const updatedRecords = [];

      for (const update of updates) {
        const { clientId, position } = update;

        if (typeof position !== "number" || position < 0) {
          throw new Error(`Invalid position: ${position}`);
        }

        const updated = await tx
          .update(clients)
          .set({ position, updatedAt: new Date() })
          .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
          .returning();

        if (updated.length === 0) {
          throw new Error(`Client not found or access denied: ${clientId}`);
        }

        updatedRecords.push({
          id: updated[0].id,
          position: updated[0].position,
        });
      }

      return updatedRecords;
    });

    res.status(200).json({
      success: true,
      message: "Clients reordered successfully",
      data: results,
    });
  } catch (error) {
    logger.error("Reorder clients error:", error);
    const message = error instanceof Error ? error.message : "Failed to reorder clients";
    res.status(message.includes("not found") ? 404 : 400).json({
      success: false,
      error: message,
    });
  }
};
