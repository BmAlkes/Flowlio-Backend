import { recordAutomationRun, type AutomationResult } from "@/utils/automationRun.util";

/** Run once, then record the same result before responding to the caller. */
export async function runManualAutomation<T extends AutomationResult>(
  key: string,
  organizationId: string | undefined,
  run: (organizationId: string | undefined) => Promise<T>,
) {
  const result = await run(organizationId);
  await recordAutomationRun(key, result, "manual", organizationId ?? null);
  return result;
}
