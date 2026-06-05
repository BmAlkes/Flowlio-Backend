import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq } from "drizzle-orm";
import {
  userOnboarding,
  clients,
  projects,
  tasks,
  invoices,
  proposals,
  timeEntries,
  userOrganizations,
  users,
} from "@/schema/schema";

type OnboardingRole = "admin" | "manager" | "viewer";

const ADMIN_MANAGER_STEPS = [
  "create_client",
  "create_project",
  "add_team_member",
  "create_task",
  "generate_proposal",
  "create_invoice",
] as const;

const VIEWER_STEPS = ["view_projects", "log_time", "update_profile"] as const;

function getStepsForRole(role: OnboardingRole): string[] {
  return role === "viewer" ? [...VIEWER_STEPS] : [...ADMIN_MANAGER_STEPS];
}

function buildEmptySteps(role: OnboardingRole): Record<string, { completedAt: string } | null> {
  return Object.fromEntries(getStepsForRole(role).map((k) => [k, null]));
}

function resolveOnboardingRole(user: any): OnboardingRole | null {
  const globalRole: string = user.role ?? "";
  if (["superadmin", "subadmin", "client"].includes(globalRole)) return null;
  if (user.isOrganizationOwner === true) return "admin";
  if (user.isOrganizationManager === true) return "manager";
  if (globalRole === "user") return "viewer";
  return null;
}

async function autoCompleteAdminManagerSteps(
  organizationId: string,
  currentSteps: Record<string, { completedAt: string } | null>,
): Promise<{ steps: Record<string, { completedAt: string } | null>; changed: boolean }> {
  const steps = { ...currentSteps };
  let changed = false;
  const now = new Date().toISOString();

  if (!steps["create_client"]) {
    const [row] = await database
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.organizationId, organizationId))
      .limit(1);
    if (row) { steps["create_client"] = { completedAt: now }; changed = true; }
  }

  if (!steps["create_project"]) {
    const [row] = await database
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
      .limit(1);
    if (row) { steps["create_project"] = { completedAt: now }; changed = true; }
  }

  if (!steps["add_team_member"]) {
    const members = await database
      .select({ id: userOrganizations.id })
      .from(userOrganizations)
      .where(eq(userOrganizations.organizationId, organizationId))
      .limit(2);
    if (members.length > 1) { steps["add_team_member"] = { completedAt: now }; changed = true; }
  }

  if (!steps["create_task"]) {
    const [row] = await database
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(projects.organizationId, organizationId))
      .limit(1);
    if (row) { steps["create_task"] = { completedAt: now }; changed = true; }
  }

  if (!steps["generate_proposal"]) {
    const [row] = await database
      .select({ id: proposals.id })
      .from(proposals)
      .where(eq(proposals.organizationId, organizationId))
      .limit(1);
    if (row) { steps["generate_proposal"] = { completedAt: now }; changed = true; }
  }

  if (!steps["create_invoice"]) {
    const [row] = await database
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.organizationId, organizationId))
      .limit(1);
    if (row) { steps["create_invoice"] = { completedAt: now }; changed = true; }
  }

  return { steps, changed };
}

async function autoCompleteViewerSteps(
  userId: string,
  currentSteps: Record<string, { completedAt: string } | null>,
): Promise<{ steps: Record<string, { completedAt: string } | null>; changed: boolean }> {
  const steps = { ...currentSteps };
  let changed = false;
  const now = new Date().toISOString();

  // view_projects is always null — marked by frontend via PATCH

  if (!steps["log_time"]) {
    const [row] = await database
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(eq(timeEntries.userId, userId))
      .limit(1);
    if (row) { steps["log_time"] = { completedAt: now }; changed = true; }
  }

  if (!steps["update_profile"]) {
    const [user] = await database
      .select({ image: users.image })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user?.image) { steps["update_profile"] = { completedAt: now }; changed = true; }
  }

  return { steps, changed };
}

function checkAllComplete(
  role: OnboardingRole,
  steps: Record<string, { completedAt: string } | null>,
): boolean {
  return getStepsForRole(role).every((k) => steps[k] != null);
}

function formatResponse(record: typeof userOnboarding.$inferSelect) {
  return {
    dismissed: record.dismissed,
    completedAt: record.completedAt,
    steps: record.steps,
  };
}

export const getOnboarding = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const onboardingRole = resolveOnboardingRole(req.user);
    if (!onboardingRole) {
      res.status(403).json({ success: false, message: "Onboarding not available for this role" });
      return;
    }

    const userId: string = req.user.id;
    const organizationId: string | null = req.user.organizationId ?? null;

    // Load or create record
    let [record] = await database
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);

    if (!record) {
      const emptySteps = buildEmptySteps(onboardingRole);
      [record] = await database
        .insert(userOnboarding)
        .values({ userId, role: onboardingRole, steps: emptySteps })
        .returning();
    }

    // Auto-complete applicable steps
    let steps = record.steps as Record<string, { completedAt: string } | null>;
    let changed = false;

    if (onboardingRole !== "viewer" && organizationId) {
      const result = await autoCompleteAdminManagerSteps(organizationId, steps);
      steps = result.steps;
      changed = result.changed;
    } else if (onboardingRole === "viewer") {
      const result = await autoCompleteViewerSteps(userId, steps);
      steps = result.steps;
      changed = result.changed;
    }

    // If steps changed or completedAt needs setting, update DB
    const allComplete = checkAllComplete(onboardingRole, steps);
    const shouldSetCompletedAt = allComplete && !record.completedAt;

    if (changed || shouldSetCompletedAt) {
      [record] = await database
        .update(userOnboarding)
        .set({
          steps,
          completedAt: shouldSetCompletedAt ? new Date() : record.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(userOnboarding.userId, userId))
        .returning();
    }

    res.status(200).json({ success: true, data: formatResponse(record) });
  } catch (error) {
    logger.error("Error fetching onboarding:", error);
    res.status(500).json({ success: false, message: "Failed to fetch onboarding" });
  }
};

export const completeOnboardingStep = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const onboardingRole = resolveOnboardingRole(req.user);
    if (!onboardingRole) {
      res.status(403).json({ success: false, message: "Onboarding not available for this role" });
      return;
    }

    const { step } = req.body;
    if (!step) {
      res.status(400).json({ success: false, message: "step is required" });
      return;
    }

    const validSteps = getStepsForRole(onboardingRole);
    if (!validSteps.includes(step)) {
      res.status(400).json({
        success: false,
        message: `Invalid step "${step}" for role "${onboardingRole}". Valid steps: ${validSteps.join(", ")}`,
      });
      return;
    }

    const userId: string = req.user.id;

    let [record] = await database
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);

    if (!record) {
      const emptySteps = buildEmptySteps(onboardingRole);
      [record] = await database
        .insert(userOnboarding)
        .values({ userId, role: onboardingRole, steps: emptySteps })
        .returning();
    }

    const steps = { ...(record.steps as Record<string, { completedAt: string } | null>) };

    // Silently ignore if already complete
    if (steps[step]) {
      res.status(200).json({ success: true, data: formatResponse(record) });
      return;
    }

    steps[step] = { completedAt: new Date().toISOString() };

    const allComplete = checkAllComplete(onboardingRole, steps);
    const completedAt = allComplete ? (record.completedAt ?? new Date()) : record.completedAt;

    [record] = await database
      .update(userOnboarding)
      .set({ steps, completedAt, updatedAt: new Date() })
      .where(eq(userOnboarding.userId, userId))
      .returning();

    res.status(200).json({ success: true, data: formatResponse(record) });
  } catch (error) {
    logger.error("Error completing onboarding step:", error);
    res.status(500).json({ success: false, message: "Failed to complete onboarding step" });
  }
};

export const dismissOnboarding = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const onboardingRole = resolveOnboardingRole(req.user);
    if (!onboardingRole) {
      res.status(403).json({ success: false, message: "Onboarding not available for this role" });
      return;
    }

    const userId: string = req.user.id;

    let [record] = await database
      .select()
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);

    if (!record) {
      const emptySteps = buildEmptySteps(onboardingRole);
      [record] = await database
        .insert(userOnboarding)
        .values({ userId, role: onboardingRole, steps: emptySteps })
        .returning();
    }

    await database
      .update(userOnboarding)
      .set({ dismissed: true, dismissedAt: new Date(), updatedAt: new Date() })
      .where(eq(userOnboarding.userId, userId));

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Error dismissing onboarding:", error);
    res.status(500).json({ success: false, message: "Failed to dismiss onboarding" });
  }
};

export const resetOnboarding = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const userId: string = req.user.id;

    const [record] = await database
      .select({ id: userOnboarding.id })
      .from(userOnboarding)
      .where(eq(userOnboarding.userId, userId))
      .limit(1);

    if (!record) {
      res.status(200).json({ success: true });
      return;
    }

    await database
      .update(userOnboarding)
      .set({
        dismissed: false,
        dismissedAt: null,
        completedAt: null,
        steps: {},
        updatedAt: new Date(),
      })
      .where(eq(userOnboarding.userId, userId));

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error("Error resetting onboarding:", error);
    res.status(500).json({ success: false, message: "Failed to reset onboarding" });
  }
};
