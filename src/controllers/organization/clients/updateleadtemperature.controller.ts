import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, clientInteractions } from "../../../schema/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import { LeadTemperature } from "../../../services/leadScoring.service";

const VALID_TEMPERATURES: LeadTemperature[] = ["Hot", "Warm", "Cold", "Lost"];

export const updateLeadTemperature = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { id: clientId } = req.params;
    const { temperature } = req.body;

    if (!clientId) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "Client ID is required" });
      return;
    }

    // null clears the manual override (back to automatic)
    if (temperature !== null && !VALID_TEMPERATURES.includes(temperature)) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: `Temperature must be one of: ${VALID_TEMPERATURES.join(", ")}, or null to reset`
      });
      return;
    }

    const client = await database.query.clients.findFirst({
      where: and(eq(clients.id, clientId), eq(clients.organizationId, organizationId))
    });

    if (!client) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Client not found" });
      return;
    }

    await database
      .update(clients)
      .set({ leadTemperature: temperature ?? null, updatedAt: new Date() })
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)));

    const previousTemperature = client.leadTemperature ?? "Auto";
    const newLabel = temperature ?? "Auto";

    if (previousTemperature !== newLabel) {
      await database.insert(clientInteractions).values({
        clientId,
        userId: req.user?.id as string,
        organizationId,
        type: "temperature_change",
        content: `Lead temperature changed from ${previousTemperature} to ${newLabel}`,
        metadata: { fromTemperature: previousTemperature, toTemperature: newLabel }
      });
    }

    res.status(status.OK).json({ success: true, message: "Lead temperature updated successfully" });

  } catch (error) {
    logger.error("Error updating lead temperature:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error).message || "Internal server error"
    });
  }
};
