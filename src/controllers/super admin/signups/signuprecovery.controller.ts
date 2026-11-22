import { Request, Response } from "express";
import { z } from "zod";
import { connection } from "@/configs/connection.config";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { env } from "@/utils/env.util";
import { logger } from "@/utils/logger.util";
import { MAX_PER_REQUEST, answerToken, listPendingSignups, recordAnswer, sendFollowups, summarize, validToken } from "@/modules/signup-recovery/service";
import { answerPage, followupEmail, type FollowupLanguage } from "@/modules/signup-recovery/email";

const withProtocol = (domain: string) => (/^https?:\/\//.test(domain) ? domain : `https://${domain}`).replace(/\/$/, "");
const continueUrl = () => withProtocol(env.FRONTEND_DOMAIN) + "/auth/signin";
const answerUrl = (followupId: string, answer: string, language: FollowupLanguage) =>
  `${withProtocol(env.BACKEND_DOMAIN)}/api/signup-feedback/${followupId}?a=${answer}&l=${language}&t=${answerToken(followupId, env.BETTER_AUTH_SECRET)}`;

/** GET /api/superadmin/pending-signups: unfinished signups, where each one stopped and the answers received. */
export const listSignupFollowups = async (_req: Request, res: Response) => {
  try {
    const signups = await listPendingSignups(connection);
    res.status(200).json({ success: true, data: signups, summary: summarize(signups) });
  } catch (error) {
    logger.error("Failed to load pending signups", error);
    res.status(500).json({ success: false, message: "Failed to load pending signups" });
  }
};

const remindInput = z.object({ userIds: z.array(z.string().min(1)).min(1).max(MAX_PER_REQUEST), language: z.enum(["pt", "en"]).default("pt") });

/** POST /api/superadmin/pending-signups/remind: { userIds, language } sends one follow-up to each eligible person. */
export const remindPendingSignups = async (req: Request, res: Response) => {
  const parsed = remindInput.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ success: false, message: `Choose between 1 and ${MAX_PER_REQUEST} people` });
  const { userIds, language } = parsed.data;
  try {
    const result = await sendFollowups(connection, userIds, req.user?.id ?? null, async (signup, followupId) => {
      const email = followupEmail(signup, language, { answer: answer => answerUrl(followupId, answer, language), continueUrl: continueUrl() });
      await brevoTransactionApi.sendTransacEmail({
        to: [{ email: signup.email, name: signup.name }],
        sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER },
        replyTo: { email: env.SUPPORT_EMAIL },
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        tags: ["signup-followup"],
      });
    });
    logger.info("Signup follow-ups sent", { actorId: req.user?.id, sent: result.sent, skipped: result.skipped.length });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    logger.error("Failed to send signup follow-ups", error);
    res.status(500).json({ success: false, message: "Failed to send follow-ups" });
  }
};

const language = (value: unknown): FollowupLanguage => (value === "en" ? "en" : "pt");

/** Public GET/POST /api/signup-feedback/:id?a=&l=&t=: GET asks to confirm, POST records the one-click answer. */
export const signupFeedback = async (req: Request, res: Response) => {
  const lang = language(req.query.l);
  const id = String(req.params.id);
  const answer = String(req.query.a ?? "");
  res.setHeader("Cache-Control", "no-store");
  res.type("html");
  if (!validToken(id, req.query.t, env.BETTER_AUTH_SECRET)) return void res.status(404).send(answerPage(lang, { kind: "invalid" }, continueUrl()));
  if (req.method !== "POST") return void res.status(200).send(answerPage(lang, { kind: "confirm", answer }, continueUrl()));
  try {
    const recorded = await recordAnswer(connection, id, answer);
    res.status(recorded ? 200 : 404).send(answerPage(lang, recorded ? { kind: "done", answer } : { kind: "invalid" }, continueUrl()));
  } catch (error) {
    logger.error("Failed to record signup feedback", error);
    res.status(500).send(answerPage(lang, { kind: "invalid" }, continueUrl()));
  }
};
