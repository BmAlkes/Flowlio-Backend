import { database } from "@/configs/connection.config";
import { timeEntries, clients, projects } from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";

export const pingPortalActivity = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    // Determine if user is a client and get their clientId
    let clientId = (req.user as any).clientRecord?.id;
    
    // If clientRecord not on req.user, try fetching it
    if (!clientId && req.user?.role === "client") {
      const clientRecord = await database.query.clients.findFirst({
        where: eq(clients.userId, userId),
      });
      clientId = clientRecord?.id;
    }

    // We only track portal activity for clients for now, 
    // as requested for the "Client Activity" report.
    if (!clientId) {
      res.status(200).json({ success: true, message: "Activity not tracked for this role" });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Look for an existing "Portal Activity" entry for this user today
    const ACTIVITY_DESCRIPTION = "Portal Activity";

    const existingEntry = await database
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, userId),
          eq(timeEntries.clientId, clientId),
          eq(timeEntries.description, ACTIVITY_DESCRIPTION),
          sql`DATE(${timeEntries.createdAt}) = CURRENT_DATE`
        )
      )
      .limit(1);

    if (existingEntry.length > 0) {
      const lastUpdate = new Date(existingEntry[0].updatedAt);
      const now = new Date();
      
      // Only increment if at least 45 seconds have passed since the last ping
      // This prevents over-counting if the user refreshes the page frequently
      if (now.getTime() - lastUpdate.getTime() >= 45000) {
        await database
          .update(timeEntries)
          .set({
            duration: (existingEntry[0].duration ?? 0) + 1,
            updatedAt: now,
          })
          .where(eq(timeEntries.id, existingEntry[0].id));
      }
    } else {
      // Find a project to associate this activity with
      const clientProject = await database.query.projects.findFirst({
        where: eq(projects.clientId, clientId),
      });

      if (!clientProject) {
        logger.warn(`No project found for client ${clientId} to log portal activity`);
        res.status(200).json({ success: true, message: "No project found" });
        return;
      }

      // Create new entry for today
      await database.insert(timeEntries).values({
        id: randomUUID(),
        userId,
        clientId,
        projectId: clientProject.id,
        taskId: null,
        startTime: new Date(),
        duration: 1,
        status: "completed",
        description: ACTIVITY_DESCRIPTION,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Error pinging portal activity:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
