import { database } from "@/configs/connection.config";
import { subscriptions } from "@/schema/schema";
import { and, desc, eq } from "drizzle-orm";

export class SessionAccessError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}

// Authorization is deliberately uncached: revocation applies on the next request.
export async function resolveSessionUser(userId: string) {
  const user = await database.query.users.findFirst({
    where: (t, { eq }) => eq(t.id, userId),
  });
  if (!user)
    throw new SessionAccessError(
      "SESSION_INVALID",
      "Account no longer exists",
      401,
    );
  if (user.status === "inactive" || user.status === "suspended") {
    throw new SessionAccessError(
      "USER_DEACTIVATED",
      "Your account has been deactivated.",
    );
  }
  if (user.role === "subadmin") {
    const subadmin =
      user.subadminId &&
      (await database.query.subadmin.findFirst({
        where: (t, { eq }) => eq(t.id, user.subadminId!),
      }));
    if (!subadmin || subadmin.permission !== "Active") {
      throw new SessionAccessError(
        "SUBADMIN_DEACTIVATED",
        "Your account access has been deactivated.",
      );
    }
  }

  const memberships = await database.query.userOrganizations.findMany({
    where: (t, { eq }) => eq(t.userId, userId),
    with: { organization: true },
    orderBy: (t, { asc }) => [asc(t.createdAt), asc(t.id)],
  });
  const membership = memberships.find((m) => m.status === "active");
  let organization = membership?.organization ?? null;
  let clientRecord;

  if (user.role === "client") {
    clientRecord = await database.query.clients.findFirst({
      where: (t, { eq }) => eq(t.userId, userId),
      with: { organization: true },
    });
    if (!clientRecord?.portalAccessEnabled || !clientRecord.organization) {
      throw new SessionAccessError(
        "PORTAL_ACCESS_DISABLED",
        "Portal access has been disabled for this account.",
      );
    }
    organization = clientRecord.organization;
  } else if (
    !user.isSuperAdmin &&
    ((memberships.length > 0 && !membership) || (membership && !organization))
  ) {
    throw new SessionAccessError(
      "MEMBERSHIP_INACTIVE",
      "No active organization membership is available.",
    );
  }

  if (
    !organization &&
    !user.isSuperAdmin &&
    !user.subadminId &&
    user.status === "active"
  ) {
    throw new SessionAccessError(
      "MEMBERSHIP_INACTIVE",
      "No active organization membership is available.",
    );
  }

  if (organization && !user.isSuperAdmin) {
    if (["suspended", "inactive"].includes(organization.status ?? "")) {
      throw new SessionAccessError(
        "ORGANIZATION_DEACTIVATED",
        "Your organization account has been deactivated.",
      );
    }
    const now = new Date();
    if (
      organization.trialEndsAt &&
      new Date(organization.trialEndsAt) < now &&
      !["active", "trialing"].includes(organization.subscriptionStatus ?? "")
    ) {
      throw new SessionAccessError(
        "TRIAL_EXPIRED",
        "Your trial period has expired.",
      );
    }
    const [subscription] = await database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.organizationId, organization.id),
          eq(subscriptions.status, "active"),
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    if (
      subscription?.currentPeriodEnd &&
      new Date(subscription.currentPeriodEnd) < now
    ) {
      throw new SessionAccessError(
        "SUBSCRIPTION_EXPIRED",
        "Your subscription has expired.",
      );
    }
  }
  return {
    ...user,
    organizationId: organization?.id ?? null,
    organization,
    userOrganization: user.role === "client" ? null : (membership ?? null),
    clientRecord,
  };
}
