import { scopedDatabase, jobContext } from "../services/jobs/context";
import { database as baseDatabase } from "@/configs/connection.config";
import { automationRuns } from "@/schema/schema";
import { logger } from "@/utils/logger.util";

export interface AutomationResult {
  itemsFound?: number;
  emailsSent?: number;
  emailsFailed?: number;
  errors?: string[];
  [key: string]: any;
}

export async function recordAutomationRun(
  automationKey: string,
  result: AutomationResult,
  triggeredBy: "cron" | "manual",
  organizationId?: string | null,
): Promise<void> {
  try {
    await database.insert(automationRuns).values({
      ...(jobContext.getStore() ? {id:jobContext.getStore()!.job.id} : {}),
      organizationId: organizationId ?? null,
      automationKey,
      itemsFound: result.itemsFound ?? result.invoicesFound ?? result.linksFound
        ?? result.webhooksFound ?? result.leadsFound ?? result.clientsFound
        ?? result.ticketsFound ?? result.organizationsFound ?? 0,
      emailsSent: jobContext.getStore() ? 0 : result.emailsSent ?? 0,
      emailsFailed: result.emailsFailed ?? 0,
      errors: result.errors ?? [],
      triggeredBy,
    });
  } catch (error) {
    if (jobContext.getStore()) throw error;
    logger.error(`recordAutomationRun failed for key "${automationKey}":`, error);
  }
}

const database = scopedDatabase(baseDatabase);
