import { Request, Response } from "express";
import { logger } from "./logger.util";
import { database } from "@/configs/connection.config";
import { userOrganizations } from "@/schema/schema";
import { eq, and } from "drizzle-orm";

/**
 * Resolve the real organization owner (purchaser) userId for an organization.
 * The real owner is the user with userOrganizations.role === "owner" for that org.
 * Used to prevent demoting the purchaser.
 */
export async function getRealOrganizationOwnerUserId(
  organizationId: string
): Promise<string | null> {
  const row = await database
    .select({ userId: userOrganizations.userId })
    .from(userOrganizations)
    .where(
      and(
        eq(userOrganizations.organizationId, organizationId),
        eq(userOrganizations.role, "owner")
      )
    )
    .limit(1);
  return row.length ? row[0].userId : null;
}

export function getOrganizationId(req: Request | any): string | null {
  const organizationId = (req.user as any)?.organizationId;

  if (!organizationId) {
    logger.warn("Organization ID not found in request user", {
      userId: (req.user as any)?.id,
      hasUser: !!req.user,
    });
  }

  return organizationId || null;
}

export function requireOrganizationId(
  req: Request | any,
  res: Response
): string | null {
  const organizationId = getOrganizationId(req);

  if (!organizationId) {
    res.status(403).json({
      success: false,
      error: "Forbidden",
      message:
        "Organization access required. Please ensure you are part of an organization.",
      code: "ORGANIZATION_REQUIRED",
    });
    return null;
  }

  return organizationId;
}

export function validateOrganizationId(
  req: Request | any,
  res: Response,
  providedOrganizationId: string | null | undefined
): boolean {
  const userOrganizationId = getOrganizationId(req);

  if (!userOrganizationId) {
    res.status(403).json({
      success: false,
      error: "Forbidden",
      message: "Organization access required",
      code: "ORGANIZATION_REQUIRED",
    });
    return false;
  }

  if (providedOrganizationId && providedOrganizationId !== userOrganizationId) {
    logger.warn("Organization ID mismatch detected", {
      userId: (req.user as any)?.id,
      userOrganizationId,
      providedOrganizationId,
      path: req.path,
    });

    res.status(400).json({
      success: false,
      error: "Bad Request",
      message: "Organization ID mismatch. Please refresh and try again.",
      code: "ORGANIZATION_MISMATCH",
    });
    return false;
  }

  return true;
}
