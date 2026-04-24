import { Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { database } from "../../../configs/connection.config";
import { clients, users } from "../../../schema/schema";
import { logActivity } from "@/utils/activity.util";

export const deleteClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userReq = req as any;
    if (!userReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const organizationId = userReq.user.organizationId;
    const { id: clientId } = req.params;

    if (!organizationId || !clientId) {
      res.status(400).json({
        error: "Organization ID and Client ID are required",
      });
      return;
    }

    // Check if client exists and belongs to the organization
    const existingClient = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existingClient.length === 0) {
      res.status(404).json({
        error: "Client not found or access denied",
      });
      return;
    }

    // Log activity before deletion
    const userId = userReq.user?.id;
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

    // Determine how to delete the client
    const clientUserId = existingClient[0].userId;

    if (clientUserId) {
      // Delete user (this will cascade to clients, account, etc. because of foreign key constraints)
      const deletedUser = await database
        .delete(users)
        .where(eq(users.id, clientUserId))
        .returning();

      if (deletedUser.length === 0) {
        // Fallback: If user record is missing but client exists, delete client directly
        const deletedClient = await database
          .delete(clients)
          .where(eq(clients.id, clientId))
          .returning();

        if (deletedClient.length === 0) {
          res.status(500).json({
            error: "Failed to delete client record",
          });
          return;
        }
      }
    } else {
      // If no user assigned, delete client directly
      const deletedClient = await database
        .delete(clients)
        .where(eq(clients.id, clientId))
        .returning();

      if (deletedClient.length === 0) {
        res.status(500).json({
          error: "Failed to delete client record",
        });
        return;
      }
    }

    res.status(200).json({
      success: true,
      message: "Client and associated user deleted successfully",
      data: {
        id: clientId,
        userId: clientUserId,
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
