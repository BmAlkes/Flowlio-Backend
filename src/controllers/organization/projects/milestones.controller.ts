import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectMilestones, projects } from "@/schema/schema";
import { eq, and, asc, max, sql } from "drizzle-orm";
import { z } from "zod";
import { types as pgTypes } from "pg";
import { milestoneVersion } from "@/modules/delivery/service";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import crypto from "crypto";

// Date-only input is independent of the browser locale and rejects rollover dates.
const milestoneDate = z.union([
  z.literal(""),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value + "T00:00:00.000Z");
    return value.slice(0, 4) !== "0000" && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }),
  z.null(),
]).transform(value => value ? new Date(value + "T00:00:00.000Z") : null);
const milestoneTitle = z.string().trim().min(1).max(255);
const createMilestoneInput = z.object({ title: milestoneTitle, dueDate: milestoneDate.optional() });
const updateMilestoneInput = z.object({
  title: milestoneTitle.optional(),
  dueDate: milestoneDate.optional(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const DEFAULT_MILESTONES = ["Discovery", "Design", "Development", "Launch & Handoff"];

async function verifyProjectOwnership(
  projectId: string,
  organizationId: string
): Promise<boolean> {
  const [project] = await database
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId)))
    .limit(1);
  return Boolean(project);
}

// GET /api/projects/:projectId/milestones
export const getMilestones = async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!(await verifyProjectOwnership(projectId, organizationId))) {
      res.status(status.FORBIDDEN).json({ success: false, message: "Project not found" });
      return;
    }

    const rows = await database
      .select()
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId))
      .orderBy(asc(projectMilestones.position));

    res.status(status.OK).json({ success: true, data: rows });
  } catch (error) {
    logger.error("getMilestones error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

// POST /api/projects/:projectId/milestones
export const createMilestone = async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId } = req.params;
    const organizationId = req.user?.organizationId;
    const parsed = createMilestoneInput.safeParse(req.body);

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!parsed.success) {
      res.status(status.BAD_REQUEST).json({ success: false, code: "INVALID_MILESTONE", message: "Provide a title of 1 to 255 characters and a valid YYYY-MM-DD due date" });
      return;
    }
    const { title, dueDate } = parsed.data;

    if (!(await verifyProjectOwnership(projectId, organizationId))) {
      res.status(status.FORBIDDEN).json({ success: false, message: "Project not found" });
      return;
    }

    const [maxRow] = await database
      .select({ pos: max(projectMilestones.position) })
      .from(projectMilestones)
      .where(eq(projectMilestones.projectId, projectId));

    const position = (maxRow?.pos ?? -1) + 1;
    const now = new Date();

    const [created] = await database
      .insert(projectMilestones)
      .values({
        id: crypto.randomUUID(),
        projectId,
        organizationId,
        title,
        status: "pending",
        position,
        dueDate: dueDate ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json({ success: true, data: created });
  } catch (error) {
    logger.error("createMilestone error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

// PATCH /api/projects/:projectId/milestones/:id
export const updateMilestone = async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(401).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!(await verifyProjectOwnership(projectId, organizationId))) {
      res.status(403).json({ success: false, message: "Project not found" });
      return;
    }

    const parsed = updateMilestoneInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, code: "INVALID_MILESTONE", message: "Invalid milestone title, date, status or version" });
      return;
    }
    const input = parsed.data;
    const result = await database.transaction(async tx => {
      const filter = and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, projectId), eq(projectMilestones.organizationId, organizationId));
      const [current] = await tx.select().from(projectMilestones).where(filter).for("update");
      if (!current) return { status: 404, body: { success: false, message: "Milestone not found" } };

      if (input.version !== undefined) {
        // Use the same raw PostgreSQL timestamp decoding as delivery review snapshots.
        // Drizzle's timestamp mapping is UTC-based and can differ from pg in other timezones.
        const snapshot = await tx.execute(sql`select id,title,status,due_date,updated_at from project_milestones where id=${id} and project_id=${projectId} and organization_id=${organizationId}`);
        // execute() returns timestamps as strings; reproduce node-pg's service parser.
        const row = snapshot.rows[0];
        const parseTimestamp = pgTypes.getTypeParser(pgTypes.builtins.TIMESTAMP);
        const versionRow = {
          ...row,
          due_date: typeof row.due_date === "string" ? parseTimestamp(row.due_date) : row.due_date,
          updated_at: typeof row.updated_at === "string" ? parseTimestamp(row.updated_at) : row.updated_at,
        };
        if (milestoneVersion(versionRow) !== input.version) {
          return { status: 409, body: { success: false, code: "SOURCE_CHANGED", message: "The milestone changed. Refresh before saving." } };
        }
      }

      const now = new Date();
      const updates: Partial<typeof projectMilestones.$inferInsert> = {};
      if (input.status !== undefined && input.status !== current.status) {
        updates.status = input.status;
        updates.completedAt = input.status === "completed" ? now : null;
      }
      if (input.title !== undefined && input.title !== current.title) updates.title = input.title;
      if (input.dueDate !== undefined && input.dueDate?.getTime() !== current.dueDate?.getTime()) updates.dueDate = input.dueDate;

      // Saving is an intentional revision, even when work changed outside these fields.
      // A monotonic timestamp gives every revision a distinct delivery snapshot version.
      const [updated] = await tx.update(projectMilestones).set({ ...updates, updatedAt: sql`greatest(clock_timestamp() at time zone 'UTC', ${projectMilestones.updatedAt} + interval '1 millisecond')` }).where(filter).returning();
      return { status: 200, body: { success: true, data: updated } };
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    logger.error("updateMilestone error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

// DELETE /api/projects/:projectId/milestones/:id
export const deleteMilestone = async (req: Request, res: Response): Promise<void> => {
  try {
    const { projectId, id } = req.params;
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!(await verifyProjectOwnership(projectId, organizationId))) {
      res.status(status.FORBIDDEN).json({ success: false, message: "Project not found" });
      return;
    }

    const deleted = await database
      .delete(projectMilestones)
      .where(and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, projectId)))
      .returning();

    if (!deleted.length) {
      res.status(404).json({ success: false, message: "Milestone not found" });
      return;
    }

    res.status(200).json({ success: true, message: "Milestone deleted" });
  } catch (error) {
    logger.error("deleteMilestone error:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
  }
};

// Seed default milestones for a newly created project
export async function seedDefaultMilestones(projectId: string, organizationId: string): Promise<void> {
  try {
    const now = new Date();
    await database.insert(projectMilestones).values(
      DEFAULT_MILESTONES.map((title, position) => ({
        id: crypto.randomUUID(),
        projectId,
        organizationId,
        title,
        status: "pending" as const,
        position,
        createdAt: now,
        updatedAt: now,
      }))
    );
  } catch (error) {
    logger.error("seedDefaultMilestones error:", error);
  }
}
