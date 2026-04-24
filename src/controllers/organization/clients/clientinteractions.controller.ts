import { Response } from "express";
import { database } from "../../../configs/connection.config";
import { clientInteractions, clients } from "../../../schema/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

// Fetch interactions for a client
export const getClientTimeline = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id: clientId } = req.params;

    const timeline = await database.query.clientInteractions.findMany({
      where: (ci, { eq, and }) => and(eq(ci.clientId, clientId), eq(ci.organizationId, organizationId)),
      with: {
        user: {
          columns: {
            name: true,
            image: true
          }
        }
      },
      orderBy: [desc(clientInteractions.createdAt)]
    });

    res.status(status.OK).json({
      success: true,
      data: timeline
    });

  } catch (error) {
    logger.error("Error fetching client timeline:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};

// Add a new interaction (note, call, email, meeting)
export const addClientInteraction = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { clientId, type, content, metadata } = req.body;

    if (!clientId || !type || !content) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Client ID, type and content are required"
      });
      return;
    }

    const interaction = await database.insert(clientInteractions).values({
      clientId,
      userId: req.user?.id as string,
      organizationId,
      type,
      content,
      metadata
    }).returning();

    // Update last interaction timestamp on client
    await database.update(clients)
      .set({ lastInteractionAt: new Date() })
      .where(eq(clients.id, clientId));

    res.status(status.CREATED).json({
      success: true,
      data: interaction[0]
    });

  } catch (error) {
    logger.error("Error adding client interaction:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};
