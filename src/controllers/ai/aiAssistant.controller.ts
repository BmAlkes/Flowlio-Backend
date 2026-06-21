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
import {
  aiTokenLimits,
  aiUsageLogs,
  calendarEvents,
  users,
  projects,
  userManagement,
  tasks,
  timeEntries,
} from "@/schema/schema";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
import { aiGateway } from "@/services/ai-gateway.service";
// Lazy import - only load OpenAI service when actually needed
// This prevents blocking server startup

/**
 * Generate AI-powered event suggestions based on user input
 */
export const generateEventSuggestions = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("🤖🤖🤖 AI EVENT SUGGESTIONS CONTROLLER CALLED 🤖🤖🤖");

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { userInput, includeSuggestions } = req.body;

    if (!userInput || typeof userInput !== "string") {
      res.status(400).json({
        success: false,
        message: "Valid user input is required",
      });
      return;
    }

    // Fetch user data for context
    const user = await database
      .select({ timezone: users.timezone, role: users.role })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user[0]) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    // Fetch recent events for context (last 7 days)
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const recentEvents = await database
      .select()
      .from(calendarEvents)
      .where(
        eq(calendarEvents.userId, req.user.id) &&
          lte(calendarEvents.date, startDate)
      )
      .limit(10)
      .orderBy(calendarEvents.date);

    const context = {
      userTimezone: user[0].timezone,
      organizationType: req.user.organization?.name || "Business",
      currentEvents: recentEvents,
    };

    // Generate AI suggestions - lazy load service
    const { openaiService } = await import("@/services/openai.service");
    // Lazy load OpenAI service - only import when needed
    const service = openaiService.instance;
    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    const aiSuggestion = await service.generateEventSuggestions(
      userInput,
      context
    );

    if (!aiSuggestion) {
      res.status(500).json({
        success: false,
        message: "Failed to generate AI suggestions",
      });
      return;
    }

    // Generate time slot suggestions if requested
    let timeSlotsSuggestions = null;
    if (includeSuggestions && service) {
      timeSlotsSuggestions = await service.suggestOptimalTimeSlots(
        aiSuggestion.suggestedDuration || 60,
        recentEvents,
        {
          userTimezone: context.userTimezone,
          preferredHours: { start: 9, end: 17 },
        }
      );
    }

    res.status(200).json({
      success: true,
      message: "AI event suggestions generated successfully",
      data: {
        suggestion: aiSuggestion,
        timeSlots: timeSlotsSuggestions?.suggestions || null,
        metadata: {
          model: "gpt-3.5-turbo",
          timestamp: new Date().toISOString(),
          contextEvents: recentEvents.length,
        },
      },
    });
  } catch (error) {
    debugLog("💥 AI EVENT SUGGESTIONS CONTROLLER ERROR 💥");

    res.status(500).json({
      success: false,
      message: "Internal server error while generating AI suggestions",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Generate event categories and tags using AI
 */
export const generateEventCategories = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("🏷️🏷️🏷️ AI EVENT CATEGORIES CONTROLLER CALLED 🏷️🏷️🏷️");

    const { title, description } = req.body;

    if (!title || typeof title !== "string") {
      res.status(400).json({
        success: false,
        message: "Event title is required",
      });
      return;
    }

    // Lazy load OpenAI service - only import when needed
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;
    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    const categories = await service.generateEventTagsAndCategories(
      title,
      description
    );

    res.status(200).json({
      success: true,
      message: "Event categories generated successfully",
      data: categories,
    });
  } catch (error) {
    logger.error("Error generating event categories:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate event categories",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Enhance event description with AI
 */
export const enhanceEventDescription = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    const { title, description } = req.body;

    if (!title || typeof title !== "string") {
      res.status(400).json({
        success: false,
        message: "Event title is required",
      });
      return;
    }

    // Lazy load OpenAI service - only import when needed
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;
    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    const enhancedDescription = await service.enhanceEventDescription(
      title,
      description
    );

    res.status(200).json({
      success: true,
      message: "Event description enhanced successfully",
      data: {
        originalDescription: description,
        enhancedDescription,
      },
    });
  } catch (error) {
    logger.error("Error enhancing event description:", error);

    res.status(500).json({
      success: false,
      message: "Failed to enhance event description",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Get AI-powered calendar insights
 */
export const getCalendarInsights = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    // Fetch user events for analysis
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - 1);

    const userEvents = await database
      .select()
      .from(calendarEvents)
      .where(
        eq(calendarEvents.userId, req.user.id) &&
          gte(calendarEvents.date, startDate)
      )
      .orderBy(calendarEvents.date);

    const insights = {
      totalEvents: userEvents.length,
      averageDuration: 0,
      mostActiveDay: "Monday",
      eventCategories: ["Work", "Personal", "Meetings"],
      recommendations: [
        "Consider scheduling breaks between meetings",
        "Your busiest day appears to be Monday - plan accordingly",
        "Try to balance work and personal events better",
      ],
    };

    // Calculate average duration
    if (userEvents.length > 0) {
      const totalDuration = userEvents.reduce(
        (sum, event) => sum + (event.endHour - event.startHour),
        0
      );
      insights.averageDuration = Math.round(totalDuration / userEvents.length);
    }

    res.status(200).json({
      success: true,
      message: "Calendar insights generated successfully",
      data: insights,
    });
  } catch (error) {
    logger.error("Error generating calendar insights:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate calendar insights",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Get comprehensive AI-powered insights for projects and tasks
 * Includes: Risk detection, delay predictions, priority insights
 */
export const getProjectInsights = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const organizationId = req.user.organizationId;
    if (!organizationId) {
      res.status(400).json({
        success: false,
        message: "Organization ID is required",
      });
      return;
    }

    // Fetch all projects for the organization
    const allProjects = await database
      .select()
      .from(projects)
      .where(eq(projects.organizationId, organizationId));

    // Fetch all tasks for these projects
    const projectIds = allProjects.map((p) => p.id);
    const allTasks =
      projectIds.length > 0
        ? await database
            .select()
            .from(tasks)
            .where(inArray(tasks.projectId, projectIds))
        : [];

    // Fetch time entries for analysis
    const allTimeEntries =
      projectIds.length > 0
        ? await database
            .select()
            .from(timeEntries)
            .where(inArray(timeEntries.projectId, projectIds))
        : [];

    const now = new Date();

    // Helper function to format hours and minutes
    const formatHoursMinutes = (totalMinutes: number) => {
      const hours = Math.floor(totalMinutes / 60);
      const minutes = Math.round(totalMinutes % 60);
      if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}m`;
      } else if (hours > 0) {
        return `${hours}h`;
      } else if (minutes > 0) {
        return `${minutes}m`;
      }
      return "0m";
    };

    const insights = {
      riskAnalysis: {
        highRiskProjects: [] as any[],
        mediumRiskProjects: [] as any[],
        lowRiskProjects: [] as any[],
        totalRisks: 0,
      },
      delayPredictions: {
        projectsAtRisk: [] as any[],
        tasksAtRisk: [] as any[],
        predictedDelays: [] as any[],
      },
      priorityInsights: {
        urgentTasks: [] as any[],
        overdueTasks: [] as any[],
        highPriorityProjects: [] as any[],
        recommendations: [] as string[],
      },
      resourceAllocation: {
        overAllocatedUsers: [] as any[],
        underUtilizedUsers: [] as any[],
        workloadDistribution: {} as Record<string, number>,
      },
      timelinePredictions: {
        projectsOnTrack: 0,
        projectsDelayed: 0,
        projectsAtRisk: 0,
        averageCompletionTime: 0,
      },
      summary: {
        totalProjects: allProjects.length,
        totalTasks: allTasks.length,
        completedTasks: allTasks.filter((t) => t.status === "completed").length,
        inProgressTasks: allTasks.filter(
          (t) =>
            t.status === "in_progress" ||
            t.status === "delay" ||
            t.status === "updated" ||
            t.status === "changes"
        ).length,
        overdueTasks: 0,
        totalHoursTracked: allTimeEntries.reduce(
          (sum, entry) => sum + (entry.duration || 0), // Keep in minutes for formatting
          0
        ),
        totalHoursTrackedFormatted: "", // Will be set later
      },
    };

    // Analyze each project for risks
    for (const project of allProjects) {
      const projectTasks = allTasks.filter((t) => t.projectId === project.id);
      const projectTimeEntries = allTimeEntries.filter(
        (te) => te.projectId === project.id
      );

      const completedTasks = projectTasks.filter(
        (t) => t.status === "completed"
      ).length;
      const totalTasks = projectTasks.length;
      const completionRate =
        totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

      // Calculate risk factors
      const riskFactors = {
        delayRisk: 0,
        budgetRisk: 0,
        resourceRisk: 0,
        overallRisk: 0,
      };

      // Check for delays
      if (project.endDate) {
        const endDate = new Date(project.endDate);
        const daysRemaining = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        const progress = project.progress || 0;
        const expectedProgress =
          daysRemaining > 0
            ? Math.max(
                0,
                100 -
                  (daysRemaining /
                    ((endDate.getTime() -
                      (project.startDate
                        ? new Date(project.startDate).getTime()
                        : now.getTime())) /
                      (1000 * 60 * 60 * 24))) *
                    100
              )
            : 100;

        if (progress < expectedProgress - 10) {
          riskFactors.delayRisk = Math.min(
            100,
            (expectedProgress - progress) * 2
          );
        }
      }

      // Check for overdue tasks
      const overdueTasks = projectTasks.filter((task) => {
        if (!task.endDate) return false;
        return new Date(task.endDate) < now && task.status !== "completed";
      });

      if (overdueTasks.length > 0) {
        riskFactors.delayRisk += overdueTasks.length * 15;
      }

      // Check resource allocation
      const estimatedHours = projectTasks.reduce(
        (sum, task) => sum + (Number(task.estimatedHours) || 0),
        0
      );
      const actualHours = projectTimeEntries.reduce(
        (sum, entry) => sum + (entry.duration || 0) / 60,
        0
      );

      if (estimatedHours > 0 && actualHours > estimatedHours * 1.2) {
        riskFactors.budgetRisk = Math.min(
          100,
          ((actualHours - estimatedHours) / estimatedHours) * 50
        );
      }

      // Calculate overall risk
      riskFactors.overallRisk = Math.min(
        100,
        riskFactors.delayRisk * 0.5 +
          riskFactors.budgetRisk * 0.3 +
          riskFactors.resourceRisk * 0.2
      );

      const projectRisk = {
        projectId: project.id,
        projectName: project.name,
        projectNumber: project.projectNumber,
        riskScore: Math.round(riskFactors.overallRisk),
        delayRisk: Math.round(riskFactors.delayRisk),
        budgetRisk: Math.round(riskFactors.budgetRisk),
        progress: project.progress || 0,
        status: project.status,
        overdueTasks: overdueTasks.length,
        totalTasks: totalTasks,
        completionRate: Math.round(completionRate),
        reasons: [] as string[],
      };

      if (riskFactors.delayRisk > 50) {
        projectRisk.reasons.push("High delay risk detected");
      }
      if (riskFactors.budgetRisk > 50) {
        projectRisk.reasons.push("Budget overrun risk");
      }
      if (overdueTasks.length > 0) {
        projectRisk.reasons.push(`${overdueTasks.length} overdue tasks`);
      }
      if (completionRate < 50 && totalTasks > 5) {
        projectRisk.reasons.push("Low completion rate");
      }

      if (riskFactors.overallRisk >= 70) {
        insights.riskAnalysis.highRiskProjects.push(projectRisk);
      } else if (riskFactors.overallRisk >= 40) {
        insights.riskAnalysis.mediumRiskProjects.push(projectRisk);
      } else {
        insights.riskAnalysis.lowRiskProjects.push(projectRisk);
      }
    }

    // Analyze tasks for delays and priorities
    for (const task of allTasks) {
      if (task.endDate) {
        // Ensure endDate is a valid Date object
        let endDate: Date;
        if (task.endDate instanceof Date) {
          endDate = task.endDate;
        } else if (typeof task.endDate === "string") {
          endDate = new Date(task.endDate);
        } else {
          // Handle timestamp or other formats
          endDate = new Date(task.endDate);
        }

        // Skip if date is invalid
        if (isNaN(endDate.getTime())) {
          logger.warn(`Invalid endDate for task ${task.id}: ${task.endDate}`);
          continue;
        }

        // Calculate days until due (negative means overdue)
        const daysUntilDue = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Log for debugging if date seems very old
        if (daysUntilDue < -100) {
          logger.warn(`Task ${task.id} has very old due date:`, {
            taskId: task.id,
            title: task.title,
            endDate: task.endDate,
            endDateParsed: endDate.toISOString(),
            daysUntilDue,
            currentDate: now.toISOString(),
          });
        }

        // Overdue tasks (only if not completed)
        // Also include tasks with "delay" status as they are delayed
        const isOverdue = daysUntilDue < 0 && task.status !== "completed";
        const isDelayStatus = task.status === "delay";

        if (isOverdue || isDelayStatus) {
          const daysOverdue =
            isDelayStatus && daysUntilDue >= 0
              ? 0 // If status is delay but date is not overdue, show as delayed
              : Math.abs(daysUntilDue);
          insights.priorityInsights.overdueTasks.push({
            taskId: task.id,
            title: task.title,
            projectId: task.projectId,
            daysOverdue, // Always positive for overdue
            status: task.status,
          });
        }

        // Tasks at risk (due within 3 days and not completed, but not overdue)
        // Only include if daysUntilDue is positive (not overdue)
        if (
          daysUntilDue >= 0 &&
          daysUntilDue <= 3 &&
          task.status !== "completed"
        ) {
          insights.delayPredictions.tasksAtRisk.push({
            taskId: task.id,
            title: task.title,
            projectId: task.projectId,
            daysUntilDue, // Positive value
            status: task.status,
          });
        }

        // Urgent tasks (due today or tomorrow, but NOT overdue)
        // CRITICAL: Only include if daysUntilDue is 0 or 1 (not negative)
        if (
          daysUntilDue >= 0 &&
          daysUntilDue <= 1 &&
          task.status !== "completed"
        ) {
          insights.priorityInsights.urgentTasks.push({
            taskId: task.id,
            title: task.title,
            projectId: task.projectId,
            daysUntilDue, // Should always be 0 or 1
            status: task.status,
          });
        }
      }
    }

    // Analyze projects for delays
    for (const project of allProjects) {
      if (project.endDate) {
        // Ensure endDate is a valid Date object
        const endDate =
          project.endDate instanceof Date
            ? project.endDate
            : new Date(project.endDate);

        // Skip if date is invalid
        if (isNaN(endDate.getTime())) {
          continue;
        }

        const daysRemaining = Math.ceil(
          (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        const progress = project.progress || 0;

        if (daysRemaining < 0) {
          // Project is overdue
          insights.delayPredictions.projectsAtRisk.push({
            projectId: project.id,
            projectName: project.name,
            daysOverdue: Math.abs(daysRemaining), // Always positive
            progress,
            status: project.status,
          });
          insights.timelinePredictions.projectsDelayed++;
        } else if (daysRemaining <= 7 && progress < 80) {
          // Project is at risk (due soon but low progress)
          insights.delayPredictions.projectsAtRisk.push({
            projectId: project.id,
            projectName: project.name,
            daysRemaining, // Positive days remaining
            progress,
            status: project.status,
          });
          insights.timelinePredictions.projectsAtRisk++;
        } else {
          // Project is on track
          insights.timelinePredictions.projectsOnTrack++;
        }
      } else {
        // No end date - consider on track
        insights.timelinePredictions.projectsOnTrack++;
      }
    }

    // Generate recommendations
    if (insights.priorityInsights.overdueTasks.length > 0) {
      insights.priorityInsights.recommendations.push(
        `You have ${insights.priorityInsights.overdueTasks.length} overdue tasks. Consider reassigning or extending deadlines.`
      );
    }

    if (insights.riskAnalysis.highRiskProjects.length > 0) {
      insights.priorityInsights.recommendations.push(
        `${insights.riskAnalysis.highRiskProjects.length} project(s) are at high risk. Review and take immediate action.`
      );
    }

    if (insights.delayPredictions.tasksAtRisk.length > 0) {
      insights.priorityInsights.recommendations.push(
        `${insights.delayPredictions.tasksAtRisk.length} task(s) are at risk of delay. Prioritize these tasks.`
      );
    }

    // Calculate summary
    insights.riskAnalysis.totalRisks =
      insights.riskAnalysis.highRiskProjects.length +
      insights.riskAnalysis.mediumRiskProjects.length;
    insights.summary.overdueTasks =
      insights.priorityInsights.overdueTasks.length;

    // Format hours tracked (convert minutes to formatted string)
    const totalMinutes = insights.summary.totalHoursTracked;
    insights.summary.totalHoursTrackedFormatted =
      formatHoursMinutes(totalMinutes);

    // Log task dates and status for debugging
    logger.info("📊 Complete Task Analysis:", {
      totalTasks: allTasks.length,
      currentDate: now.toISOString(),
      allTasks: allTasks.map((t) => {
        const taskEndDate = t.endDate
          ? t.endDate instanceof Date
            ? t.endDate
            : new Date(t.endDate as any)
          : null;
        const daysUntilDue = taskEndDate
          ? Math.ceil(
              (taskEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            )
          : null;
        return {
          id: t.id,
          title: t.title,
          status: t.status,
          endDate: t.endDate,
          endDateParsed: taskEndDate?.toISOString() || null,
          daysUntilDue,
          isInProgress:
            t.status === "in_progress" ||
            t.status === "delay" ||
            t.status === "updated" ||
            t.status === "changes",
          isCompleted: t.status === "completed",
          isOverdue:
            daysUntilDue !== null &&
            daysUntilDue < 0 &&
            t.status !== "completed",
          isDelayStatus: t.status === "delay",
        };
      }),
      summary: {
        totalTasks: allTasks.length,
        completed: allTasks.filter((t) => t.status === "completed").length,
        inProgress: allTasks.filter(
          (t) =>
            t.status === "in_progress" ||
            t.status === "delay" ||
            t.status === "updated" ||
            t.status === "changes"
        ).length,
        overdue: insights.priorityInsights.overdueTasks.length,
      },
      projectsAtRisk: insights.delayPredictions.projectsAtRisk.map((p) => ({
        projectId: p.projectId,
        projectName: p.projectName,
        daysRemaining: p.daysRemaining,
        daysOverdue: p.daysOverdue,
        progress: p.progress,
        status: p.status,
      })),
    });

    // Calculate average completion time
    const completedTasksWithTime = allTasks.filter(
      (t) => t.status === "completed" && t.startDate && t.updatedAt
    );
    if (completedTasksWithTime.length > 0) {
      const totalCompletionTime = completedTasksWithTime.reduce((sum, task) => {
        const start = new Date(task.startDate!).getTime();
        const end = new Date(task.updatedAt).getTime();
        return sum + (end - start);
      }, 0);
      insights.timelinePredictions.averageCompletionTime = Math.round(
        totalCompletionTime /
          completedTasksWithTime.length /
          (1000 * 60 * 60 * 24)
      );
    }

    res.status(200).json({
      success: true,
      message: "AI insights generated successfully",
      data: insights,
    });
  } catch (error) {
    logger.error("Error generating project insights:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate project insights",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("File type not supported"));
    }
  },
});

/**
 * Advanced AI conversation with file analysis
 */
export const advancedConversation = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("🤖🤖🤖 ADVANCED AI CONVERSATION CONTROLLER CALLED 🤖🤖🤖");
    logger.info("🤖🤖🤖 ADVANCED AI CONVERSATION CONTROLLER CALLED 🤖🤖🤖");

    // Get lazy-loaded service instance
    // Lazy load OpenAI service - only import when needed
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;

    // Debug: Check if openaiService is properly imported
    debugLog("🔍 openaiService check:", {
      exists: !!service,
      hasGenerateAdvancedResponse:
        typeof service?.generateAdvancedResponse === "function",
      serviceType: typeof service,
    });

    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { userInput, conversationHistory } = req.body;

    // Parse conversation history if it's a JSON string
    let parsedConversationHistory = conversationHistory;
    if (typeof conversationHistory === "string") {
      try {
        parsedConversationHistory = JSON.parse(conversationHistory);
        // logger.info("🔍 Parsed conversation history:", {
        //   length: parsedConversationHistory.length,
        //   firstMessage: parsedConversationHistory[0],
        //   allRoles: parsedConversationHistory.map((msg: any) => msg.role),
        // });
      } catch (error) {
        logger.warn("Failed to parse conversation history:", error);
        parsedConversationHistory = [];
      }
    } else if (conversationHistory) {
      logger.info("🔍 Conversation history already parsed:", {
        length: conversationHistory.length,
        firstMessage: conversationHistory[0],
        allRoles: conversationHistory.map((msg: any) => msg.role),
      });
    }

    if (!userInput || typeof userInput !== "string") {
      res.status(400).json({
        success: false,
        message: "Valid user input is required",
      });
      return;
    }

    // logger.info("Advanced AI Conversation Request:", {
    //   userId: req.user.id,
    //   userInput,
    //   hasHistory: !!conversationHistory,
    //   hasFiles: !!req.files,
    // });

    // Process uploaded files if any
    let fileContext = [];
    if (req.files && req.files.length > 0) {
      // logger.info("📁 Processing uploaded files:", {
      //   fileCount: req.files.length,
      //   fileNames: req.files.map((f: any) => f.originalname),
      // });

      for (const file of req.files) {
        try {
          // logger.info("🔍 Analyzing file:", {
          //   fileName: file.originalname,
          //   filePath: file.path,
          //   fileSize: file.size,
          // });

          if (service) {
            debugLog("🔍 CALLING analyzeFile for:", file.originalname);
            const analysis = await service.analyzeFile(file.path, userInput);
            debugLog("✅ analyzeFile returned:", {
              fileName: file.originalname,
              analysisLength: analysis.length,
              firstChars: analysis.substring(0, 100),
            });

            // logger.info("✅ File analysis completed:", {
            //   fileName: file.originalname,
            //   analysisLength: analysis.length,
            //   firstChars: analysis.substring(0, 100),
            // });

            fileContext.push({
              name: file.originalname,
              content: analysis,
            });

            // Clean up the file after analysis
            service.cleanupFile(file.path);
          }
        } catch (error) {
          logger.error(`❌ Error analyzing file ${file.originalname}:`, error);
        }
      }
    } else {
      logger.info("📁 No files uploaded for this request");
    }

    // Build messages array for the gateway, mirroring generateAdvancedResponse internals
    const gatewayMessages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [];

    if (parsedConversationHistory && parsedConversationHistory.length > 0) {
      for (const msg of parsedConversationHistory) {
        const role = msg.role === "ai" ? "assistant" : msg.role;
        gatewayMessages.push({
          role: role as "system" | "user" | "assistant",
          content: msg.content,
        });
      }
    }

    // Fold file context into the user message (mirrors generateAdvancedResponse file handling)
    let userMessageContent = userInput;
    if (fileContext.length > 0) {
      const filesText = (fileContext as Array<{ name: string; content: string }>)
        .map((f) => `File: ${f.name}\nContent: ${f.content.substring(0, 2000)}`)
        .join("\n\n");
      userMessageContent = `Context from uploaded files:\n${filesText}\n\nUser question: ${userInput}`;
    }
    gatewayMessages.push({ role: "user", content: userMessageContent });

    // Generate advanced AI response via gateway (logs usage automatically)
    const chatResult = await aiGateway.chat({
      feature: "chat",
      messages: gatewayMessages,
      orgId: req.user?.organizationId,
      userId: req.user?.id,
      model: "gpt-4o",
      endpoint: req.originalUrl || req.path,
    });
    (res as any).locals._aiLogged = true;

    debugLog("✅ ADVANCED AI CONVERSATION COMPLETED SUCCESSFULLY");
    // logger.info("✅ ADVANCED AI CONVERSATION COMPLETED SUCCESSFULLY");

    res.status(200).json({
      success: true,
      message: "AI response generated successfully",
      data: {
        response: chatResult.content,
        type: "text",
        metadata: {
          model: chatResult.model,
          tokens: chatResult.totalTokens,
        },
        filesAnalyzed: fileContext.length,
      },
    });
  } catch (error) {
    debugLog("💥 ADVANCED AI CONVERSATION CONTROLLER ERROR 💥");
    // logger.error("💥 ADVANCED AI CONVERSATION CONTROLLER ERROR 💥");
    logger.error("Error in advanced AI conversation:", error);
    debugError("Full error details:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error while processing AI request",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Test OpenAI service connection
 */
export const testOpenAI = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const testResult = await aiGateway.chat({
      feature: "test",
      messages: [{ role: "user", content: "Hello, this is a test message." }],
      orgId: req.user?.organizationId,
      userId: req.user?.id,
      model: "gpt-4o",
      endpoint: req.originalUrl || req.path,
    });
    (res as any).locals._aiLogged = true;

    res.status(200).json({
      success: true,
      message: "OpenAI service test completed",
      data: {
        response: testResult.content,
        type: "text",
        serviceWorking: true,
      },
    });
  } catch (error) {
    logger.error("❌ OpenAI service test failed:", error);

    res.status(500).json({
      success: false,
      message: "OpenAI service test failed",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Generate images using DALL-E
 */
export const generateImage = async (req: any, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    // Lazy load OpenAI service - only import when needed
    const { openaiService } = await import("@/services/openai.service");
    const service = openaiService.instance;
    if (!service) {
      res.status(500).json({
        success: false,
        message: "AI service is not available",
      });
      return;
    }

    const { prompt, size = "1024x1024" } = req.body;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({
        success: false,
        message: "Image prompt is required",
      });
      return;
    }

    // logger.info("AI Image Generation Request:", {
    // userId: req.user.id,
    // prompt,
    // size,
    // });

    // Generate image using OpenAI image generation
    const imageUrl = await service.generateImage(prompt, size);

    if (!imageUrl) {
      res.status(500).json({
        success: false,
        message: "Failed to generate image",
      });
      return;
    }

    const imageTokenCost = 1000;
    const imageModel = "gpt-image-1";

    if (req.user.organizationId && req.user.id) {
      await database.insert(aiUsageLogs).values({
        feature: "image_generation",
        provider: "openai",
        model: imageModel,
        promptTokens: imageTokenCost,
        completionTokens: 0,
        totalTokens: imageTokenCost,
        organizationId: req.user.organizationId,
        userId: req.user.id,
        status: "success",
        endpoint: req.originalUrl || req.path,
        durationMs: null,
        metadata: {
          prompt,
          size,
          responseType: imageUrl.startsWith("data:") ? "base64" : "url",
        },
      });
      (res as any).locals._aiLogged = true;

      await database
        .update(aiTokenLimits)
        .set({
          tokensUsed: sql`${aiTokenLimits.tokensUsed} + ${imageTokenCost}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(aiTokenLimits.organizationId, req.user.organizationId),
            isNull(aiTokenLimits.userId),
            isNull(aiTokenLimits.feature),
            eq(aiTokenLimits.isActive, true)
          )
        );
    }

    res.status(200).json({
      success: true,
      message: "Image generated successfully",
      data: {
        imageUrl,
        prompt,
        size,
        metadata: {
          model: imageModel,
          tokenCost: imageTokenCost,
          timestamp: new Date().toISOString(),
        },
      },
    });
  } catch (error) {
    logger.error("Error generating image:", error);

    res.status(500).json({
      success: false,
      message: "Failed to generate image",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Generate task from natural language input using AI
 */
export const generateTaskFromNaturalLanguage = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("🤖🤖🤖 AI TASK CREATION CONTROLLER CALLED 🤖🤖🤖");

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const { userInput } = req.body;

    if (!userInput || typeof userInput !== "string") {
      res.status(400).json({
        success: false,
        message: "Valid user input is required",
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

    // Fetch available projects for context
    const availableProjects = await database
      .select({
        id: projects.id,
        name: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projects)
      .where(eq(projects.organizationId, organizationId))
      .limit(50); // Limit to prevent too much context

    // Fetch available users for context from userManagement table
    const availableUserMembers = await database
      .select({
        id: userManagement.id,
        firstname: userManagement.firstname,
        lastname: userManagement.lastname,
        email: userManagement.email,
      })
      .from(userManagement)
      .where(eq(userManagement.organizationId, organizationId))
      .limit(50); // Limit to prevent too much context

    // Format users for AI context
    const availableUsers = availableUserMembers.map((um) => ({
      id: um.id,
      name: `${um.firstname} ${um.lastname}`,
      email: um.email,
    }));

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

    // Generate task from natural language
    const taskData = await service.generateTaskFromNaturalLanguage(userInput, {
      availableProjects: availableProjects.map((p) => ({
        id: p.id,
        name: p.name,
        projectNumber: p.projectNumber || undefined,
      })),
      availableUsers: availableUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
      })),
      organizationName: (req.user as any)?.organization?.name,
    });

    if (!taskData) {
      res.status(500).json({
        success: false,
        message: "Failed to generate task from natural language",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Task generated successfully from natural language",
      data: taskData,
    });
  } catch (error) {
    logger.error("Error generating task from natural language:", error);
    debugError("Full error details:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error while generating task",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Generate a professional proposal document using AI
 * This endpoint is used by the AI Assist page to auto-generate PDF-ready proposals
 */
export const generateProposal = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    debugLog("📄📄📄 AI PROPOSAL GENERATION CONTROLLER CALLED 📄📄📄");

    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const {
      clientName,
      projectTitle,
      projectDescription,
      budget,
      timeline,
      companyName,
      additionalRequirements,
      language = "English",
    } = req.body;

    if (!projectTitle || !projectDescription) {
      res.status(400).json({
        success: false,
        message: "Project title and description are required",
      });
      return;
    }

    // Build a detailed prompt for proposal generation
    const proposalPrompt = `You are a professional business proposal writer. You must write the ENTIRE proposal in ${language}. All sections, titles, descriptions, and content must be written exclusively in ${language}. Do not use any other language.

Generate a comprehensive, professional project proposal document based on the following details:

Project Title: ${projectTitle}
Client Name: ${clientName || "Valued Client"}
Our Company: ${companyName || "Our Company"}
Project Description: ${projectDescription}
${budget ? `Budget: ${budget}` : ""}
${timeline ? `Timeline: ${timeline}` : ""}
${additionalRequirements ? `Additional Requirements: ${additionalRequirements}` : ""}

Generate a complete professional proposal with the following sections. Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):
{
  "executiveSummary": "A compelling 2-3 paragraph executive summary of the proposal",
  "projectOverview": "Detailed overview of the project scope and objectives",
  "scopeOfWork": ["List of specific deliverables and work items, each as a string"],
  "approach": "Our methodology and approach to completing this project",
  "timeline": {
    "totalDuration": "Total estimated project duration",
    "phases": [
      { "phase": "Phase name", "duration": "Duration", "description": "What happens in this phase" }
    ]
  },
  "investment": {
    "totalBudget": "${budget || "To be discussed"}",
    "breakdown": [
      { "item": "Cost item name", "amount": "Amount or percentage", "description": "Brief description" }
    ]
  },
  "whyUs": ["Array of 4-5 key reasons why client should choose us, each as a string"],
  "terms": ["Array of 4-5 standard terms and conditions, each as a string"],
  "nextSteps": ["Array of 3-4 clear next steps to move forward, each as a string"]
}`;

    const aiResponse = await aiGateway.chat({
      feature: "proposal",
      messages: [{ role: "user", content: proposalPrompt }],
      orgId: req.user?.organizationId,
      userId: req.user?.id,
      model: "gpt-4o",
      endpoint: req.originalUrl || req.path,
    });
    (res as any).locals._aiLogged = true;

    // Parse the AI response as JSON
    let proposalData;
    try {
      // Extract JSON from the response
      const jsonMatch = aiResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        proposalData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in AI response");
      }
    } catch (parseError) {
      debugError("Failed to parse proposal JSON:", parseError);
      // Fallback: return the raw text for the frontend to handle
      res.status(200).json({
        success: true,
        message: "Proposal generated successfully",
        data: {
          rawContent: aiResponse.content,
          clientName: clientName || "Valued Client",
          projectTitle,
          companyName: companyName || "Our Company",
          generatedAt: new Date().toISOString(),
        },
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Proposal generated successfully",
      data: {
        ...proposalData,
        clientName: clientName || "Valued Client",
        projectTitle,
        companyName: companyName || "Our Company",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    debugError("💥 AI PROPOSAL GENERATION CONTROLLER ERROR 💥");
    logger.error("Error generating proposal:", error);

    res.status(500).json({
      success: false,
      message: "Internal server error while generating proposal",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

// Export multer middleware for file uploads
export { upload };
