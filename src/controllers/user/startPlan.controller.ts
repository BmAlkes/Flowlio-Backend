import { Request, Response } from "express";
import { z } from "zod";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { notifySuperAdmins } from "@/utils/superadmin-notification.util";
import { insertDefaultAITokenLimit, getAITokenLimitFromPlan } from "@/utils/aiTokenLimit.util";
import { SignupFlowError, startOrganization, type StartMode } from "@/modules/signup-flow/service";

const startInput = z.object({
  planId: z.string().min(1),
  organizationName: z.string().trim().max(120).optional(),
  country: z.string().trim().length(2).optional().or(z.literal("").transform(() => undefined)),
});

/** Creates the organization of a new account on a free plan or a no-card trial and answers the request. */
export async function startNewOrganization(req: Request, res: Response, mode: StartMode) {
  const parsed = startInput.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ success: false, message: "Choose a plan and a valid country" });
  const userId = req.user?.id;
  if (!userId) return void res.status(401).json({ success: false, message: "Authentication required" });
  try {
    const result = await startOrganization(connection, { userId, mode, ...parsed.data });
    await insertDefaultAITokenLimit(result.organizationId, await getAITokenLimitFromPlan(result.planId)).catch(error =>
      logger.warn("AI token limit could not be set for a new organization", { organizationId: result.organizationId, error: String(error) }));
    notifySuperAdmins({
      type: mode === "trial" ? "userSubscribe" : "newCompany",
      title: mode === "trial" ? "New free trial started" : "New free plan organization",
      message: `"${result.organizationName}" started ${mode === "trial" ? `a free trial of ${result.planName}` : `the ${result.planName} plan`}.`,
      details: { "Plan Name": result.planName, "User Email": req.user?.email ?? "", ...(result.trialEndsAt ? { "Trial Ends": result.trialEndsAt.split("T")[0] } : {}) },
    }).catch(() => {});
    logger.info("Organization started", { userId, organizationId: result.organizationId, mode, planId: result.planId });
    res.status(200).json({ success: true, message: `Plan "${result.planName}" activated successfully`, data: { ...result, orgId: result.organizationId, status: mode === "trial" ? "trialing" : "active" } });
  } catch (error) {
    if (error instanceof SignupFlowError) return void res.status(error.status).json({ success: false, code: error.code, message: error.message });
    logger.error("Failed to start organization", error);
    res.status(500).json({ success: false, message: "Failed to activate plan" });
  }
}

/** POST /api/subscriptions/start-trial: { planId, organizationName, country } starts a paid plan's free trial without payment. */
export const startTrial = (req: Request, res: Response) => startNewOrganization(req, res, "trial");
