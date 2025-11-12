import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { database } from "../../../configs/connection.config";
import { clients } from "../../../schema/schema";
import { logActivity } from "@/utils/activity.util";

export const deleteClient = async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated and has organization ID
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const organizationId = req.user.organizationId;
    const { id: clientId } = req.params;

    if (!organizationId || !clientId) {
      return res.status(400).json({
        error: "Organization ID and Client ID are required",
      });
    }

    // Check if client exists and belongs to the organization
    const existingClient = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingClient.length === 0) {
      return res.status(404).json({
        error: "Client not found or access denied",
      });
    }

    // Log activity before deletion
    const userId = req.user?.id;
    if (organizationId && userId && existingClient[0]) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "client",
        action: "delete",
        resource: "client",
        resourceId: clientId,
        message: `Deleted client: ${existingClient[0].name}`,
      });
    }

    // Delete client
    const deletedClient = await database
      .delete(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId)
        )
      )
      .returning();

    if (deletedClient.length === 0) {
      return res.status(500).json({
        error: "Failed to delete client",
      });
    }

    res.status(200).json({
      success: true,
      message: "Client deleted successfully",
      data: {
        id: deletedClient[0].id,
        deleted: true,
      },
    });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({
      error: "Internal server error while deleting client",
    });
  }
};
