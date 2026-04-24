import { database } from "@/configs/connection.config";
import { recentActivities } from "@/schema/schema";
import { logger } from "@/utils/logger.util";

export interface LogActivityInput {
  organizationId: string;
  actorId: string; // who performed the action
  userId?: string; // subject of activity if applicable
  type: string; // auth, user, task, project, invoice, system
  action: string; // create, update, delete, login, logout, assign
  resource: string; // user, task, project, invoice
  resourceId?: string;
  message?: string;
  metadata?: any;
}

export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await database.insert(recentActivities).values({
      organizationId: input.organizationId,
      actorId: input.actorId,
      userId: input.userId ?? null,
      type: input.type,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      message: input.message ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    // Log error but don't throw - activity logging should not break the main operation
    logger.error("Failed to log activity:", error);
    logger.error("Activity input:", input);
  }
}
