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
import { calendarEvents, users } from "@/schema/schema";
import { eq, gte, lte } from "drizzle-orm";
import multer from "multer";
import path from "path";
import fs from "fs";
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

    const { userInput, conversationHistory, userPreferences } = req.body;

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

    // Generate advanced AI response
    const aiResponse = await service.generateAdvancedResponse(userInput, {
      conversationHistory: parsedConversationHistory,
      files: fileContext,
      userPreferences,
    });

    debugLog("✅ ADVANCED AI CONVERSATION COMPLETED SUCCESSFULLY");
    // logger.info("✅ ADVANCED AI CONVERSATION COMPLETED SUCCESSFULLY");

    res.status(200).json({
      success: true,
      message: "AI response generated successfully",
      data: {
        response: aiResponse.response,
        type: aiResponse.type,
        metadata: aiResponse.metadata,
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

    // Test with a simple request
    const testResponse = await service.generateAdvancedResponse(
      "Hello, this is a test message."
    );

    res.status(200).json({
      success: true,
      message: "OpenAI service test completed",
      data: {
        response: testResponse.response,
        type: testResponse.type,
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

    // Generate image using DALL-E
    const imageUrl = await service.generateImage(prompt, size);

    if (!imageUrl) {
      res.status(500).json({
        success: false,
        message: "Failed to generate image",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "Image generated successfully",
      data: {
        imageUrl,
        prompt,
        size,
        metadata: {
          model: "dall-e-3",
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

// Export multer middleware for file uploads
export { upload };
