import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { BackupError, createBackup, listBackups } from "@/modules/organization-data/backup";
import { restoreOrganization } from "@/modules/organization-data/restore";
import { organizationsPendingDeletion } from "@/modules/organization-data/deletion";
import { ImportError, importInput, importRows } from "@/modules/organization-data/import";

function fail(res: Response, error: unknown, fallback: string) {
  if (error instanceof BackupError || error instanceof ImportError) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return;
  }
  const pg = error as { code?: string; detail?: string; table?: string };
  // Constraint errors explain why a restore cannot be applied (e.g. a person in the backup no longer exists).
  if (pg?.code && /^23/.test(pg.code)) {
    res.status(409).json({ success: false, code: "CONSTRAINT_" + pg.code, message: [pg.table, pg.detail].filter(Boolean).join(": ") || fallback });
    return;
  }
  logger.error(fallback, error);
  res.status(500).json({ success: false, message: fallback });
}

/** POST /api/organizations/import: { kind: "leads" | "clients" | "tasks", rows } (owner or manager). */
export const importOrganizationData = async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!req.user?.id || !organizationId) return void res.status(403).json({ success: false, message: "Organization access required" });
    const parsed = importInput.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, code: "INVALID_IMPORT", message: "Choose what to import and send between 1 and 2000 rows" });
    const result = await importRows(connection, { id: req.user.id, organizationId }, parsed.data);
    logger.info("Spreadsheet import", { organizationId, kind: parsed.data.kind, created: result.created, skipped: result.skipped.length });
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    fail(res, error, "Import failed");
  }
};

/** GET /api/superadmin/organization-data: every organization with its last backup and deletion schedule. */
export const listOrganizationData = async (_req: Request, res: Response) => {
  try {
    const { rows } = await connection.query(
      `select o.id, o.name, o.subscription_status, o.inactive_since, o.deletion_warning_sent_at,
         o.inactive_since + interval '90 days' deletes_at, b.last_backup_at, coalesce(b.backups, 0)::int backups
       from organizations o
       left join lateral (select max(created_at) last_backup_at, count(*) backups from organization_backups where organization_id=o.id) b on true
       order by o.inactive_since nulls last, lower(o.name)`,
    );
    res.status(200).json({ success: true, data: rows, pendingDeletion: (await organizationsPendingDeletion(connection)).length, autoDeleteEnabled: process.env.ORG_AUTO_DELETE_ENABLED === "true" });
  } catch (error) {
    fail(res, error, "Failed to load organizations");
  }
};

export const listOrganizationBackups = async (req: Request, res: Response) => {
  try {
    res.status(200).json({ success: true, data: await listBackups(connection, String(req.params.organizationId)) });
  } catch (error) {
    fail(res, error, "Failed to load backups");
  }
};

export const createOrganizationBackup = async (req: Request, res: Response) => {
  try {
    const backup = await createBackup(connection, String(req.params.organizationId), "manual", req.user?.id ?? null);
    res.status(201).json({ success: true, data: backup });
  } catch (error) {
    fail(res, error, "Failed to create the backup");
  }
};

/** POST /api/superadmin/organizations/:organizationId/restore: { backupId, confirm }. Without confirm it is a dry run. */
export const restoreOrganizationBackup = async (req: Request, res: Response) => {
  try {
    const backupId = typeof req.body?.backupId === "string" ? req.body.backupId : "";
    if (!backupId) return void res.status(400).json({ success: false, message: "backupId is required" });
    const dryRun = req.body?.confirm !== true;
    const report = await restoreOrganization(connection, { organizationId: String(req.params.organizationId), backupId, dryRun, actorId: req.user?.id ?? null });
    if (!dryRun) logger.warn("Organization restored from backup", { organizationId: req.params.organizationId, backupId, actorId: req.user?.id, preRestoreBackupId: report.preRestoreBackupId });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    fail(res, error, "Restore failed");
  }
};
