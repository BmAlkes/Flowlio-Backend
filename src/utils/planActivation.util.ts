import crypto from "crypto";
import { database } from "@/configs/connection.config";
import { subscriptions, organizations, subscriptionPlans } from "@/schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import { insertDefaultAITokenLimit, DEFAULT_PAID_TOKEN_LIMIT } from "@/utils/aiTokenLimit.util";

export interface ActivatePlanParams {
  orgId: string;
  planId: string;
  periodStart: Date;
  periodEnd: Date;
  notes?: string | null;
  assignedBy?: string;
}

export interface ActivatePlanResult {
  orgName: string;
  planName: string;
}

/**
 * Activates a subscription plan for an organization.
 * Upserts the subscriptions row, syncs org fields, and seeds AI token limit.
 * Used by both the manual assign-plan endpoint and the PayPal payment confirm flow.
 */
export async function activatePlanForOrg(
  params: ActivatePlanParams
): Promise<ActivatePlanResult> {
  const { orgId, planId, periodStart, periodEnd, notes, assignedBy } = params;

  const [plan] = await database
    .select({ id: subscriptionPlans.id, name: subscriptionPlans.name, features: subscriptionPlans.features })
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, planId))
    .limit(1);

  if (!plan) throw new Error(`Plan ${planId} not found`);

  const [org] = await database
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) throw new Error(`Organization ${orgId} not found`);

  const now = new Date();
  const meta = {
    assignedManually: true,
    assignedAt: now.toISOString(),
    assignedBy: assignedBy ?? "superadmin",
    notes: notes ?? null,
  };

  // Upsert subscription
  const [existing] = await database
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.organizationId, orgId))
    .limit(1);

  if (existing) {
    await database
      .update(subscriptions)
      .set({
        planId,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        updatedAt: now,
        metadata: meta,
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await database.insert(subscriptions).values({
      id: crypto.randomUUID().replace(/-/g, ""),
      organizationId: orgId,
      planId,
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      createdAt: now,
      updatedAt: now,
      metadata: meta,
    });
  }

  // Sync org
  await database
    .update(organizations)
    .set({
      subscriptionPlanId: planId,
      subscriptionStatus: "active",
      subscriptionStartDate: periodStart,
      subscriptionEndDate: periodEnd,
      status: "active",
      updatedAt: now,
    })
    .where(eq(organizations.id, orgId));

  // Seed AI token limit from plan
  const aiTokenLimit =
    typeof plan.features?.aiTokenLimit === "number" && plan.features.aiTokenLimit > 0
      ? plan.features.aiTokenLimit
      : DEFAULT_PAID_TOKEN_LIMIT;
  await insertDefaultAITokenLimit(orgId, aiTokenLimit);

  logger.info(`Plan "${plan.name}" activated for org "${org.name}" (${orgId})`);

  return { orgName: org.name, planName: plan.name };
}
