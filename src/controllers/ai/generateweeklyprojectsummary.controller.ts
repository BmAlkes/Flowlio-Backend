// Conditional logging helper
const isDevelopment = process.env.NODE_ENV === "development";
const isDebugMode = process.env.DEBUG_LOGGING === "true";

const debugLog = (...args: any[]) => {
  if (isDevelopment || isDebugMode) {
    console.log(...args);
  }
};

const debugError = (...args: any[]) => {
  if (isDevelopment || isDebugMode) {
    console.error(...args);
  }
};

import { Response } from "express";
import { logger } from "@/utils/logger.util";
import { database } from "@/configs/connection.config";
import { projects, tasks, timeEntries } from "@/schema/schema";
import { eq, gte, lte, and, inArray, or } from "drizzle-orm";

/**
 * Generate weekly project summary using AI
 */
export const generateWeeklyProjectSummary = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("📊📊📊 WEEKLY PROJECT SUMMARY CONTROLLER CALLED 📊📊📊");

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const organizationId = (req.user as any)?.organizationId;
    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Calculate week start and end dates (last 7 days)
    const weekEnd = new Date();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    // Get query parameters for custom date range (optional)
    const { startDate, endDate } = req.query;
    let customWeekStart = weekStart;
    let customWeekEnd = weekEnd;

    if (startDate && endDate) {
      customWeekStart = new Date(startDate);
      customWeekEnd = new Date(endDate);
    }

    logger.info("📅 Weekly summary period:", {
      start: customWeekStart.toISOString(),
      end: customWeekEnd.toISOString(),
    });

    // Fetch all projects for the organization
    const organizationProjects = await database
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
        status: projects.status,
        progress: projects.progress,
        startDate: projects.startDate,
        endDate: projects.endDate,
        description: projects.description,
      })
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    // Fetch tasks for these projects that were active during the week
    // (created, updated, or have dates within the week)
    const projectIds = organizationProjects.map((p) => p.id);

    type TaskResult = {
      id: string;
      title: string;
      description: string | null;
      status: string | null;
      projectId: string;
      assignedTo: string | null;
      startDate: Date | null;
      endDate: Date | null;
      estimatedHours: string | null;
      actualHours: string | null;
    };

    let organizationTasks: TaskResult[] = [];
    if (projectIds.length > 0) {
      try {
        organizationTasks = await database
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            projectId: tasks.projectId,
            assignedTo: tasks.assignedTo,
            startDate: tasks.startDate,
            endDate: tasks.endDate,
            estimatedHours: tasks.estimatedHours,
            actualHours: tasks.actualHours,
          })
          .from(tasks)
          .where(
            and(
              inArray(tasks.projectId, projectIds),
              or(
                gte(tasks.createdAt, customWeekStart),
                gte(tasks.updatedAt, customWeekStart)
              )
            )
          );
      } catch (taskError) {
        logger.error("Error fetching tasks:", taskError);
        // Fallback: get all tasks for projects (simpler query)
        organizationTasks = await database
          .select({
            id: tasks.id,
            title: tasks.title,
            description: tasks.description,
            status: tasks.status,
            projectId: tasks.projectId,
            assignedTo: tasks.assignedTo,
            startDate: tasks.startDate,
            endDate: tasks.endDate,
            estimatedHours: tasks.estimatedHours,
            actualHours: tasks.actualHours,
          })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds));
      }
    }

    // Fetch time entries for the week
    type TimeEntryResult = {
      id: string;
      projectId: string;
      taskId: string | null;
      duration: number | null;
      billable: boolean | null;
      description: string | null;
      startTime: Date;
    };

    let organizationTimeEntries: TimeEntryResult[] = [];
    if (projectIds.length > 0) {
      organizationTimeEntries = await database
        .select({
          id: timeEntries.id,
          projectId: timeEntries.projectId,
          taskId: timeEntries.taskId,
          duration: timeEntries.duration,
          billable: timeEntries.billable,
          description: timeEntries.description,
          startTime: timeEntries.startTime,
        })
        .from(timeEntries)
        .where(
          and(
            inArray(timeEntries.projectId, projectIds),
            gte(timeEntries.startTime, customWeekStart),
            lte(timeEntries.startTime, customWeekEnd)
          )
        );
    }

    logger.info("📊 Data fetched:", {
      projects: organizationProjects.length,
      tasks: organizationTasks.length,
      timeEntries: organizationTimeEntries.length,
    });

    // Check if we have any data to summarize
    if (organizationProjects.length === 0) {
      res.status(400).json({
        success: false,
        message: "No projects found for this organization",
      });
      return;
    }

    // Lazy load OpenAI service
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;
    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    // Generate weekly summary using AI
    const summary = await service.generateWeeklyProjectSummary({
      projects: organizationProjects.map((p) => ({
        id: p.id,
        name: p.name,
        projectNumber: p.projectNumber,
        status: p.status || "active",
        progress: p.progress || 0,
        startDate: p.startDate,
        endDate: p.endDate,
        description: p.description || null,
      })),
      tasks: organizationTasks.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description || null,
        status: t.status || "todo",
        projectId: t.projectId,
        assignedTo: t.assignedTo || null,
        startDate: t.startDate,
        endDate: t.endDate,
        estimatedHours: t.estimatedHours
          ? parseFloat(t.estimatedHours.toString())
          : null,
        actualHours: t.actualHours
          ? parseFloat(t.actualHours.toString())
          : null,
      })),
      timeEntries: organizationTimeEntries.map((te) => ({
        projectId: te.projectId,
        taskId: te.taskId || null,
        duration: te.duration ?? 0, // duration is in minutes
        billable: te.billable ?? false,
        description: te.description || null,
      })),
      weekStart: customWeekStart,
      weekEnd: customWeekEnd,
      organizationName: (req.user as any)?.organization?.name || undefined,
    });

    if (!summary) {
      res.status(500).json({
        success: false,
        message: "Failed to generate weekly project summary",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Weekly project summary generated successfully",
      data: {
        ...summary,
        period: {
          start: customWeekStart.toISOString(),
          end: customWeekEnd.toISOString(),
        },
      },
    });
  } catch (error) {
    logger.error("Error generating weekly project summary:", error);
    debugError("Full error details:", error);

    // Log more details in development
    if (process.env.NODE_ENV === "development") {
      logger.error(
        "Error stack:",
        error instanceof Error ? error.stack : "No stack"
      );
      logger.error(
        "Error message:",
        error instanceof Error ? error.message : String(error)
      );
    }

    res.status(500).json({
      success: false,
      message: "Internal server error while generating weekly summary",
      error:
        process.env.NODE_ENV === "development"
          ? error instanceof Error
            ? error.message
            : String(error)
          : undefined,
    });
  }
};
