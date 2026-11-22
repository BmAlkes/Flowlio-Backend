import { randomUUID } from "node:crypto";
import { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { connection, database } from "@/configs/connection.config";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { account } from "@/schema/schema";
import { env } from "@/utils/env.util";
import { logger } from "@/utils/logger.util";
import { anonymizeUser, exportUserData, PrivacyError, requestAccountDeletion } from "@/modules/privacy/service";

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof PrivacyError) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return;
  }
  logger.error(fallback, error);
  res.status(500).json({ success: false, message: fallback });
}

/** GET /api/user/privacy/export: the signed-in user's personal data as a JSON download (LGPD art. 18, II and V). */
export const exportMyData = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) return void res.status(401).json({ success: false, message: "Authentication required" });
    const data = await exportUserData(connection, { id: req.user.id, email: req.user.email });
    res.setHeader("Content-Disposition", `attachment; filename="flowlio-meus-dados-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (error) {
    fail(res, error, "Failed to export your data");
  }
};

async function passwordMatches(userId: string, password: unknown) {
  const credential = await database.query.account.findFirst({
    where: and(eq(account.userId, userId), eq(account.providerId, "credential")),
    columns: { password: true },
  });
  if (!credential?.password) return true; // No password on this account (e.g. OTP only): the session is the proof.
  if (typeof password !== "string" || !password) return false;
  const { auth } = await import("@/lib/auth");
  const context = await auth.$context;
  return context.password.verify({ password, hash: credential.password });
}

/** POST /api/user/privacy/delete-account: body { password, confirm: true } (LGPD art. 18, VI). */
export const deleteMyAccount = async (req: Request, res: Response) => {
  try {
    const user = req.user;
    if (!user?.id) return void res.status(401).json({ success: false, message: "Authentication required" });
    if (req.body?.confirm !== true) return void res.status(400).json({ success: false, code: "CONFIRMATION_REQUIRED", message: "Confirm the deletion to continue" });
    if (!(await passwordMatches(user.id, req.body?.password))) {
      return void res.status(400).json({ success: false, code: "INVALID_PASSWORD", message: "Incorrect password" });
    }
    const result = await requestAccountDeletion(connection, {
      id: user.id,
      organizationId: user.organizationId,
      isOrganizationOwner: user.isOrganizationOwner,
      isSuperAdmin: user.isSuperAdmin,
    });
    if (result.status === "pending") {
      await notifyPrivacyTeam(user.email, user.organizationId);
      return void res.status(202).json({ success: true, status: "pending", message: "Your request was registered and will be completed within 15 days." });
    }
    logger.info("Account anonymized at the user's request", { userId: user.id });
    res.status(200).json({ success: true, status: "completed", message: "Your account and personal data were deleted." });
  } catch (error) {
    fail(res, error, "Failed to delete your account");
  }
};

async function notifyPrivacyTeam(requesterEmail: string, organizationId?: string) {
  const to = env.PRIVACY_CONTACT_EMAIL;
  if (!to) {
    logger.warn("Organization owner requested account deletion but PRIVACY_CONTACT_EMAIL is not set", { organizationId });
    return;
  }
  await brevoTransactionApi.sendTransacEmail({
    to: [{ email: to }],
    sender: { name: "Flowlio", email: env.BREVO_SENDER },
    subject: "LGPD: pedido de exclusão de conta (dono de organização)",
    textContent: `O dono da organização ${organizationId ?? "-"} (${requesterEmail}) pediu a exclusão da conta.\n\n` +
      "Prazo legal: 15 dias (LGPD art. 19). Exclua a organização no painel de super admin e conclua o pedido em Configurações do Super Admin > Pedidos LGPD.",
  }).catch(error => logger.error("Failed to email the privacy team about a deletion request", { organizationId, error }));
}

/** GET /api/superadmin/privacy-requests: open and recent data subject requests. */
export const listPrivacyRequests = async (_req: Request, res: Response) => {
  try {
    const { rows } = await connection.query(
      `select r.id, r.type, r.status, r.requested_at, r.completed_at, r.organization_id, r.details, u.email, u.name, o.name organization_name
       from privacy_requests r left join users u on u.id=r.user_id left join organizations o on o.id=r.organization_id
       order by (r.status='pending') desc, r.requested_at desc limit 200`,
    );
    res.status(200).json({ success: true, data: rows });
  } catch (error) {
    fail(res, error, "Failed to load privacy requests");
  }
};

/** POST /api/superadmin/privacy-requests/:id/complete: anonymizes the requester and closes the request. */
export const completePrivacyRequest = async (req: Request, res: Response) => {
  try {
    const { rows } = await connection.query<{ user_id: string | null; type: string; status: string }>(
      "select user_id, type, status from privacy_requests where id=$1", [req.params.id],
    );
    const request = rows[0];
    if (!request) return void res.status(404).json({ success: false, message: "Request not found" });
    if (request.status !== "pending") return void res.status(409).json({ success: false, message: "Request is already closed" });
    if (request.type === "deletion" && request.user_id) await anonymizeUser(connection, request.user_id).catch(error => {
      if (!(error instanceof PrivacyError && error.code === "NOT_FOUND")) throw error; // Already removed with the organization.
    });
    await connection.query("update privacy_requests set status='completed', completed_at=now() where id=$1", [req.params.id]);
    res.status(200).json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to complete the privacy request");
  }
};

/** GET /api/organizations/export: everything the organization stores in Flowlio, as one JSON file (owner only). */
export const exportMyOrganization = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!req.user?.id || !organizationId) return void res.status(403).json({ success: false, message: "Organization owner access required" });
    const { exportOrganization } = await import("@/modules/privacy/organization-export");
    const data = await exportOrganization(connection, organizationId);
    await connection.query(
      "insert into privacy_requests (id, user_id, organization_id, type, status, details, completed_at) values ($1,$2,$3,'export','completed',$4,now())",
      [randomUUID(), req.user.id, organizationId, JSON.stringify({ scope: "organization", tables: Object.keys(data.counts).length })],
    );
    res.setHeader("Content-Disposition", `attachment; filename="flowlio-organizacao-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(data);
  } catch (error) {
    fail(res, error, "Failed to export the organization data");
  }
};
