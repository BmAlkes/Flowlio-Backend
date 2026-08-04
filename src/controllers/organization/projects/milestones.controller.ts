import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { projectMilestones, projects } from "@/schema/schema";
import { eq, and, asc, max } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import crypto from "crypto";

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
    const { title, dueDate } = req.body;

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(status.BAD_REQUEST).json({ success: false, message: "title is required" });
      return;
    }

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
        title: title.trim(),
        status: "pending",
        position,
        dueDate: dueDate ? new Date(dueDate) : null,
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
    const { status: newStatus, title, dueDate } = req.body;

    if (!organizationId) {
      res.status(401).json({ success: false, message: "Organization context required" });
      return;
    }

    if (!(await verifyProjectOwnership(projectId, organizationId))) {
      res.status(403).json({ success: false, message: "Project not found" });
      return;
    }

    const now = new Date();
    const updates: Partial<typeof projectMilestones.$inferInsert> = { updatedAt: now };

    if (newStatus !== undefined) {
      const validStatuses = ["pending", "in_progress", "completed"] as const;
      if (!validStatuses.includes(newStatus)) {
        res.status(400).json({ success: false, message: "Invalid status" });
        return;
      }
      updates.status = newStatus;
      updates.completedAt = newStatus === "completed" ? now : null;
    }

    if (title !== undefined && typeof title === "string" && title.trim()) {
      updates.title = title.trim();
    }

    if (dueDate !== undefined) {
      updates.dueDate = dueDate ? new Date(dueDate) : null;
    }

    const [updated] = await database
      .update(projectMilestones)
      .set(updates)
      .where(and(eq(projectMilestones.id, id), eq(projectMilestones.projectId, projectId)))
      .returning();

    if (!updated) {
      res.status(404).json({ success: false, message: "Milestone not found" });
      return;
    }

    res.status(200).json({ success: true, data: updated });
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
