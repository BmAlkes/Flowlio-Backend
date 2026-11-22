import type { Pool } from "pg";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { cloudinary } from "@/configs/cloudinary.config";
import { env } from "@/utils/env.util";
import { logger } from "@/utils/logger.util";
import { runScheduledBackups } from "./backup";
import { runAutoDeletion, trackInactiveOrganizations } from "./deletion";

function loginUrl() {
  return env.FRONTEND_DOMAIN.replace(/\/$/, "") + "/auth/signin";
}

async function warnOwner(owner: { email: string; name: string; organization_name: string }, deletesAt: string) {
  const day = new Date(deletesAt).toISOString().slice(0, 10).split("-").reverse().join("/");
  await brevoTransactionApi.sendTransacEmail({
    to: [{ email: owner.email, name: owner.name }],
    sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER },
    subject: `Flowlio: os dados de ${owner.organization_name} serão excluídos em ${day}`,
    textContent:
      `Olá ${owner.name},\n\nA assinatura da organização "${owner.organization_name}" está inativa. Conforme os Termos de Uso, ` +
      `os dados serão excluídos definitivamente em ${day}.\n\nPara mantê-los, reative a assinatura. Para guardar uma cópia, entre em ` +
      `${loginUrl()} e use Configurações > Privacidade e dados > Exportar dados da organização.\n\n` +
      `---\n\nHi ${owner.name},\n\nThe subscription of "${owner.organization_name}" is inactive. Under the Terms of Service its data ` +
      `will be permanently deleted on ${day}. Reactivate the subscription to keep it, or sign in at ${loginUrl()} and use ` +
      `Settings > Privacy & data > Export organization data to keep a copy.\n\nFlowlio`,
  });
}

async function removeAsset(publicId: string) {
  for (const resourceType of ["image", "raw", "video"]) {
    const result = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true }).catch(() => null);
    if (result?.result === "ok") return;
  }
}

/** Runs from the worker's hourly cycle. Each part is independent so one failure does not stop the others. */
export async function runOrganizationDataMaintenance(pool: Pool) {
  await trackInactiveOrganizations(pool).catch(error => logger.warn("Inactive organization tracking failed", { error }));
  await runAutoDeletion(pool, {
    enabled: env.ORG_AUTO_DELETE_ENABLED === "true",
    warn: warnOwner,
    removeAsset,
    log: (organizationId, error) => logger.error("Organization auto-deletion step failed", { organizationId, error }),
  }).then(result => { if (result.warned || result.deleted) logger.info("Organization auto-deletion", result); })
    .catch(error => logger.warn("Organization auto-deletion failed", { error }));
  await runScheduledBackups(pool, 25, (organizationId, error) => logger.warn("Organization backup failed", { organizationId, error }))
    .catch(error => logger.warn("Organization backups failed", { error }));
}
