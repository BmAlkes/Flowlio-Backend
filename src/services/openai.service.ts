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

// Lazy imports for heavy dependencies - only load when needed
// This prevents blocking server startup
import OpenAI from "openai";
import { env } from "@/utils/env.util";
import fs from "fs";
import path from "path";
import { logger } from "@/utils/logger.util";
import { ChatCompletionMessageParam } from "openai/resources/chat";

// Heavy dependencies (pdf-parse, pdf-lib, pdfjs-dist, tesseract.js)
// are imported dynamically when needed to avoid blocking server startup

export class OpenAIService {
  private openai: OpenAI | null;
  private uploadDir: string;

  constructor() {
    logger.info("🔧 OpenAI Service Constructor called");
    logger.info("🔧 Environment check:", {
      hasOpenAI: !!env.OPEN_AI,
      openAILength: env.OPEN_AI?.length || 0,
      openAIStart: env.OPEN_AI?.substring(0, 10) || "none",
    });

    if (!env.OPEN_AI) {
      logger.warn("OpenAI API key not provided. AI features will be disabled.");
      this.openai = null;
      return;
    }

    try {
      this.openai = new OpenAI({
        apiKey: env.OPEN_AI,
      });
      logger.info("✅ OpenAI client initialized successfully");
    } catch (error) {
      logger.error("❌ Failed to initialize OpenAI client:", error);
      this.openai = null;
      return;
    }

    // Create upload directory for file processing
    this.uploadDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    logger.info("✅ OpenAI Service initialized successfully");
  }

  /**
   * Generate smart event suggestions based on user input
   */
  async generateEventSuggestions(
    userInput: string,
    context?: {
      currentEvents?: any[];
      userTimezone?: string;
      organizationType?: string;
    }
  ): Promise<{
    eventTitle: string;
    eventDescription: string;
    suggestedDuration: number;
    suggestedDateTime?: string;
    suggestedAttendees?: string[];
    tags?: string[];
    category?: string;
  } | null> {
    try {
      if (!this.openai) {
        logger.warn(
          "OpenAI service not available. Returning fallback response."
        );
        return {
          eventTitle: "",
          eventDescription:
            "I'm sorry, AI features are currently unavailable. Please try again later.",
          suggestedDuration: 0,
          tags: [],
          category: "General",
        };
      }

      logger.info("🤖 AI Event Suggestion Request:", {
        userInput,
        context,
      });

      const systemPrompt = `You are Flowlio AI, a helpful and intelligent assistant. You're exactly like ChatGPT - completely free-form, conversational, and knowledgeable about everything.

      YOUR ROLE:
      - Answer ANY question on ANY topic
      - Help with ANY task or request
      - Be creative, analytical, and insightful
      - Provide detailed explanations when needed
      - Be conversational and engaging
      - Offer multiple perspectives and solutions
      - Ask clarifying questions when helpful
      
      YOU CAN HELP WITH:
      - General knowledge and trivia
      - Writing and editing
      - Math and science
      - History and culture
      - Creative writing and brainstorming
      - Problem-solving and analysis
      - Productivity and organization
      - Calendar and event management (if specifically asked)
      - ANY other topic or question
      
      CONTEXT INFO (use only if relevant to the question):
      - User timezone: ${context?.userTimezone || "UTC"}
      - Organization: ${context?.organizationType || "Business"}
      - Recent events: ${JSON.stringify(
        context?.currentEvents?.slice(0, 3) || []
      )}
      
      RESPONSE STYLE:
      - Be completely natural and conversational
      - Don't assume any specific topic or purpose
      - Respond to whatever the user asks
      - Be helpful, accurate, and engaging
      - Use examples and explanations when helpful
      - Be creative and think outside the box
      
      Remember: You're a completely free-form AI assistant - users can ask you absolutely anything!`;

      const response = await this.openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const aiResponse = response.choices[0]?.message?.content;
      if (!aiResponse) {
        logger.error("No AI response received");
        return null;
      }

      // Handle the AI response - prioritize conversational responses
      let suggestion;
      try {
        // Try to extract JSON from the response (for calendar events)
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsedJson = JSON.parse(jsonMatch[0]);
          // Only use JSON if it looks like a calendar event
          if (parsedJson.eventTitle || parsedJson.eventDescription) {
            suggestion = parsedJson;
          } else {
            // Treat as conversational response
            suggestion = {
              eventTitle: "",
              eventDescription: aiResponse,
              suggestedDuration: 0,
              tags: [],
              category: "General",
              isConversational: true,
            };
          }
        } else {
          // For general conversational responses, return the full text
          suggestion = {
            eventTitle: "",
            eventDescription: aiResponse,
            suggestedDuration: 0,
            tags: [],
            category: "General",
            isConversational: true,
          };
        }
      } catch (parseError) {
        // If JSON parsing fails, treat as conversational response
        suggestion = {
          eventTitle: "",
          eventDescription: aiResponse,
          suggestedDuration: 0,
          tags: [],
          category: "General",
          isConversational: true,
        };
      }

      logger.info("✅ AI Response Generated:", suggestion);

      return suggestion;
    } catch (error) {
      logger.error("❌ Error generating AI event suggestion:", error);
      return null;
    }
  }

  /**
   * Generate smart event categories and tags
   */
  async generateEventTagsAndCategories(
    eventTitle: string,
    eventDescription?: string
  ): Promise<{
    category: string;
    tags: string[];
    priority?: "Low" | "Medium" | "High";
  }> {
    try {
      if (!this.openai) {
        return {
          category: "General",
          tags: ["Meeting"],
          priority: "Medium",
        };
      }

      const response = await this.openai.chat.completions.create({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `Analyze the given event and categorize it appropriately. 
            Return a JSON object with: category (from: Meeting, Personal, Work, Family, Health, Education, Travel, Social, etc.), 
            tags (array of relevant keywords), and priority (Low, Medium, or High).`,
          },
          {
            role: "user",
            content: `Event Title: ${eventTitle}${
              eventDescription ? `\nDescription: ${eventDescription}` : ""
            }`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      });

      const aiResponse = response.choices[0]?.message?.content;
      let result;

      try {
        result = JSON.parse(aiResponse || "{}");
      } catch {
        result = {
          category: "General",
          tags: ["Meeting"],
          priority: "Medium",
        };
      }

      return result;
    } catch (error) {
      logger.error("Error generating event tags:", error);
      return {
        category: "General",
        tags: ["Meeting"],
        priority: "Medium",
      };
    }
  }

  /**
   * Suggest optimal time slots based on existing events
   */
  async suggestOptimalTimeSlots(
    duration: number,
    currentEvents: any[],
    preferences?: {
      preferredHours?: { start: number; end: number };
      preferredDays?: string[];
      userTimezone?: string;
    }
  ): Promise<{
    suggestions: {
      date: string;
      timeSlots: Array<{
        startTime: string;
        endTime: string;
        confidence: number;
        reasons: string[];
      }>;
    }[];
  }> {
    try {
      if (!this.openai) {
        return {
          suggestions: [
            {
              date: new Date().toISOString().split("T")[0],
              timeSlots: [
                {
                  startTime: "09:00",
                  endTime: `${9 + Math.floor(duration / 60)}:${duration % 60}`,
                  confidence: 50,
                  reasons: ["Default fallback"],
                },
              ],
            },
          ],
        };
      }

      logger.info("🤖 AI Time Slot Suggestion Request:", {
        duration,
        currentEvents: currentEvents.length,
        preferences,
      });

      const eventsContext = currentEvents.map((event) => ({
        title: event.title,
        start: event.startHour,
        end: event.endHour,
        date: event.date,
      }));

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a calendar optimization AI. Analyze the existing events and suggest optimal time slots for a new ${duration}-minute event.

            Consider:
            - Existing event times to avoid conflicts
            - Preferred working hours (9 AM - 5 PM by default)
            - Break times between meetings (15-30 minutes)
            - Timezone: ${preferences?.userTimezone || "UTC"}
            
            Current events: ${JSON.stringify(eventsContext)}
            
            Return JSON with suggestedTimeSlots containing date, timeSlots (startTime, endTime, confidence 0-100, reasons array).`,
          },
          {
            role: "user",
            content: `I need a ${duration}-minute time slot. Preferences: ${JSON.stringify(
              preferences
            )}`,
          },
        ],
        temperature: 0.4,
        max_tokens: 800,
      });

      const aiResponse = response.choices[0]?.message?.content;
      let suggestion;

      try {
        suggestion = JSON.parse(aiResponse || "{}");
      } catch {
        suggestion = {
          suggestions: [
            {
              date: new Date().toISOString().split("T")[0],
              timeSlots: [
                {
                  startTime: "09:00",
                  endTime: `${9 + Math.floor(duration / 60)}:${duration % 60}`,
                  confidence: 70,
                  reasons: ["Standard business hours"],
                },
              ],
            },
          ],
        };
      }

      logger.info("✅ AI Time Slot Suggestions Generated:", suggestion);

      return suggestion;
    } catch (error) {
      logger.error("❌ Error generating time slot suggestions:", error);
      return {
        suggestions: [
          {
            date: new Date().toISOString().split("T")[0],
            timeSlots: [
              {
                startTime: "09:00",
                endTime: `${9 + Math.floor(duration / 60)}:${duration % 60}`,
                confidence: 50,
                reasons: ["Default fallback"],
              },
            ],
          },
        ],
      };
    }
  }

  /**
   * Enhance event description with AI
   */
  async enhanceEventDescription(
    title: string,
    currentDescription?: string
    // context?: any
  ): Promise<string> {
    try {
      if (!this.openai) {
        return currentDescription || "";
      }

      const response = await this.openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `Enhance the event description to be more professional and informative while keeping it concise (2-3 sentences max). Include relevant details like agenda, objectives, or preparation notes if appropriate.`,
          },
          {
            role: "user",
            content: `Event Title: ${title}\nCurrent Description: ${
              currentDescription || "Not provided"
            }`,
          },
        ],
        temperature: 0.6,
        max_tokens: 200,
      });

      return response.choices[0]?.message?.content || currentDescription || "";
    } catch (error) {
      logger.error("Error enhancing event description:", error);
      return currentDescription || "";
    }
  }

  /**
   * Extract text from PDF using OCR (for image-based PDFs)
   */
  private async extractTextWithOCR(fileBuffer: Buffer): Promise<string> {
    try {
      debugLog("🔍 Starting OCR text extraction...");
      logger.info("🔍 Starting OCR text extraction...");

      // Lazy import tesseract.js - only load when needed
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      const {
        data: { text },
      } = await worker.recognize(fileBuffer);
      await worker.terminate();

      debugLog("✅ OCR text extraction completed:", {
        textLength: text.length,
        firstChars: text.substring(0, 100),
      });

      return text.trim();
    } catch (error) {
      debugError("❌ OCR text extraction failed:", error);
      logger.error("❌ OCR text extraction failed:", error);
      return "OCR text extraction failed. This might be due to image quality or format issues.";
    }
  }

  /**
   * Analyze uploaded files (PDF, images, documents)
   */
  async analyzeFile(filePath: string, userMessage: string): Promise<string> {
    try {
      logger.info("🔍 analyzeFile method called:", {
        filePath,
        userMessage: userMessage.substring(0, 50),
      });

      debugLog("🔍 ANALYZE FILE CALLED - DEBUG:", {
        filePath,
        fileName: path.basename(filePath),
        fileExtension: path.extname(filePath).toLowerCase(),
      });

      if (!this.openai) {
        logger.warn("⚠️ OpenAI service not initialized");
        return "AI features are currently unavailable. Please try again later.";
      }

      const fileExtension = path.extname(filePath).toLowerCase();
      const fileName = path.basename(filePath);

      logger.info("📄 File details:", {
        fileName,
        fileExtension,
        filePath,
        extensionCheck: fileExtension === ".pdf",
        supportedExtensions: [".pdf", ".txt", ".doc", ".docx"],
        isSupported: [".pdf", ".txt", ".doc", ".docx"].includes(fileExtension),
      });

      // Read file content
      const fileBuffer = fs.readFileSync(filePath);
      logger.info("📊 File buffer loaded:", {
        bufferLength: fileBuffer.length,
      });

      let analysisPrompt = `Please analyze this file "${fileName}" and respond to the user's question: "${userMessage}"\n\n`;

      if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fileExtension)) {
        logger.info("🖼️ Processing as image file");
        // Image analysis using Vision API
        const base64Image = fileBuffer.toString("base64");

        const response = await this.openai.chat.completions.create({
          model: "gpt-4o", // Using GPT-4 with vision
          messages: [
            {
              role: "system",
              content:
                "You are an AI assistant that can analyze images and answer questions about them. Provide detailed, helpful responses.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: analysisPrompt,
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/${fileExtension.slice(
                      1
                    )};base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
          max_tokens: 1000,
          temperature: 0.7,
        });

        return (
          response.choices[0]?.message?.content ||
          "I couldn't analyze this image. Please try again."
        );
      } else if ([".pdf", ".txt", ".doc", ".docx"].includes(fileExtension)) {
        logger.info("📄 Processing as text-based file");
        // Text-based file analysis
        let fileContent = "";

        if (fileExtension === ".pdf") {
          // Parse PDF content properly
          debugLog("🔍 PDF DETECTED - STARTING PARSING:", fileName);
          try {
            logger.info("🔍 Starting PDF parsing for file:", fileName);
            debugLog("🔍 Starting PDF parsing for file:", fileName);
            logger.info("📊 File buffer info:", {
              bufferLength: fileBuffer.length,
              firstBytes: fileBuffer.slice(0, 20).toString("hex"),
            });

            // Enhanced PDF parsing with better error handling
            logger.info("🧪 Starting PDF parsing process...");
            debugLog("🧪 Starting PDF parsing process...");
            debugLog("📊 File buffer details:", {
              bufferLength: fileBuffer.length,
              firstBytes: fileBuffer.slice(0, 10).toString("hex"),
              isPDF: fileBuffer.slice(0, 4).toString() === "%PDF",
            });

            let pdfData;
            let parsingMethod = "none";

            try {
              // Try pdf-parse first (most reliable for text extraction)
              // Lazy import - only load when needed
              debugLog("🔍 Trying pdf-parse parsing...");
              parsingMethod = "pdf-parse";
              const pdf = (await import("pdf-parse")).default;
              pdfData = await pdf(fileBuffer);

              debugLog("✅ pdf-parse parsing successful:", {
                textLength: pdfData.text?.length || 0,
                numPages: pdfData.numpages || 0,
                firstChars: pdfData.text?.substring(0, 100) || "No text",
              });

              // Validate the extracted text
              if (!pdfData.text || pdfData.text.trim().length === 0) {
                debugLog(
                  "⚠️ pdf-parse returned empty text, might be image-based PDF"
                );
                throw new Error("pdf-parse returned empty text");
              }

              // Check if extracted text looks like raw PDF data
              if (
                pdfData.text.includes("%PDF") ||
                pdfData.text.includes("stream") ||
                pdfData.text.includes("endstream")
              ) {
                debugLog(
                  "⚠️ pdf-parse returned raw PDF data, might be image-based PDF"
                );
                throw new Error("pdf-parse returned raw PDF data");
              }
            } catch (parseError) {
              debugLog("❌ pdf-parse failed, trying pdfjs-dist:", parseError);
              logger.error("❌ pdf-parse failed:", parseError);

              try {
                // Fallback to pdfjs-dist - lazy import
                debugLog("🔍 Trying pdfjs-dist parsing...");
                parsingMethod = "pdfjs-dist";
                const pdfjsLib = await import("pdfjs-dist");
                const loadingTask = pdfjsLib.getDocument({ data: fileBuffer });
                const pdfDoc = await loadingTask.promise;
                const numPages = pdfDoc.numPages;
                let extractedText = "";

                for (let i = 1; i <= numPages; i++) {
                  const page = await pdfDoc.getPage(i);
                  const textContent = await page.getTextContent();
                  const pageText = textContent.items
                    .map((item: any) => item.str)
                    .join(" ");
                  extractedText += pageText + "\n";
                }

                pdfData = {
                  text: extractedText.trim(),
                  numpages: numPages,
                };

                debugLog("✅ pdfjs-dist parsing successful:", {
                  textLength: pdfData.text.length,
                  numPages: pdfData.numpages,
                  firstChars: pdfData.text.substring(0, 100),
                });

                // Validate the extracted text
                if (!pdfData.text || pdfData.text.trim().length === 0) {
                  debugLog(
                    "⚠️ pdfjs-dist returned empty text, might be image-based PDF"
                  );
                  throw new Error("pdfjs-dist returned empty text");
                }

                // Check if extracted text looks like raw PDF data
                if (
                  pdfData.text.includes("%PDF") ||
                  pdfData.text.includes("stream") ||
                  pdfData.text.includes("endstream")
                ) {
                  debugLog(
                    "⚠️ pdfjs-dist returned raw PDF data, might be image-based PDF"
                  );
                  throw new Error("pdfjs-dist returned raw PDF data");
                }
              } catch (pdfjsError) {
                debugLog(
                  "❌ pdfjs-dist also failed, trying pdf-lib:",
                  pdfjsError
                );
                logger.error("❌ pdfjs-dist failed:", pdfjsError);

                try {
                  // Final fallback to pdf-lib - lazy import
                  debugLog("🔍 Trying pdf-lib parsing...");
                  parsingMethod = "pdf-lib";
                  const { PDFDocument } = await import("pdf-lib");
                  const pdfDoc = await PDFDocument.load(fileBuffer);
                  const pages = pdfDoc.getPages();

                  pdfData = {
                    text: `PDF loaded with ${pages.length} pages, but text extraction failed. This might be a scanned PDF or image-based document that requires OCR processing.`,
                    numpages: pages.length,
                  };

                  debugLog("🔄 pdf-lib fallback completed:", {
                    pages: pages.length,
                    textLength: pdfData.text.length,
                  });
                } catch (altError) {
                  debugLog("❌ All PDF parsing methods failed:", altError);
                  logger.error("❌ All PDF parsing methods failed:", {
                    pdfParseError: parseError,
                    pdfjsError: pdfjsError,
                    pdfLibError: altError,
                  });

                  // Try OCR as final fallback for image-based PDFs
                  debugLog("🔍 Trying OCR as final fallback...");
                  parsingMethod = "OCR";
                  try {
                    const ocrText = await this.extractTextWithOCR(fileBuffer);
                    pdfData = {
                      text: ocrText,
                      numpages: 1, // OCR doesn't provide page count
                    };
                    debugLog("✅ OCR fallback successful:", {
                      textLength: pdfData.text.length,
                      firstChars: pdfData.text.substring(0, 100),
                    });
                  } catch (ocrError) {
                    debugLog("❌ OCR also failed:", ocrError);
                    // Return a helpful error message
                    pdfData = {
                      text: `Error: Unable to extract text from this PDF using any method. This could be due to:\n- The PDF is password-protected\n- The PDF contains only images (scanned document)\n- The PDF is corrupted\n- The PDF uses unsupported text encoding\n- Poor image quality for OCR\n\nPlease try with a different PDF file or ensure the PDF contains selectable text.`,
                      numpages: 0,
                    };
                  }
                }
              }
            }

            debugLog(`📄 PDF parsing completed using method: ${parsingMethod}`);
            logger.info(
              `📄 PDF parsing completed using method: ${parsingMethod}`
            );

            fileContent = pdfData.text || "";
            debugLog("✅ PDF PARSED SUCCESSFULLY:", {
              fileName,
              textLength: fileContent.length,
              pages: pdfData.numpages,
              firstChars: fileContent.substring(0, 100),
            });
            logger.info("✅ PDF parsed successfully:", {
              fileName,
              textLength: fileContent.length,
              pages: pdfData.numpages,
              firstChars: fileContent.substring(0, 100),
            });

            // Check if we got meaningful text
            if (!fileContent || fileContent.trim().length === 0) {
              logger.warn("⚠️ PDF parsing returned empty text");
              fileContent =
                "The PDF appears to be empty or contains no readable text content. This might be a scanned PDF or image-based PDF that requires OCR processing.";
            } else if (fileContent.length < 50) {
              logger.warn(
                "⚠️ PDF parsing returned very short text:",
                fileContent
              );
              fileContent = `The PDF contains very little text content: "${fileContent}". This might indicate the PDF is mostly images or formatted content that couldn't be extracted as plain text.`;
            } else {
              // Clean up the text content
              fileContent = fileContent
                .replace(/\s+/g, " ") // Replace multiple whitespace with single space
                .replace(/\n\s*\n/g, "\n") // Remove empty lines
                .trim();

              logger.info("📄 Cleaned PDF content:", {
                originalLength: pdfData.text?.length || 0,
                cleanedLength: fileContent.length,
                firstChars: fileContent.substring(0, 200),
              });
            }
          } catch (error) {
            debugError("❌ PDF PARSING ERROR:", error);
            logger.error("❌ Error parsing PDF:", error);
            logger.error("❌ Error details:", {
              message:
                error instanceof Error ? error.message : "Unknown message",
              stack: error instanceof Error ? error.stack : "Unknown stack",
            });
            fileContent =
              "Error: Could not parse PDF content. The file might be corrupted, password-protected, or in an unsupported format. Please try with a different PDF file.";
          }
        } else {
          fileContent = fileBuffer.toString("utf-8");
        }

        // Validate file content
        debugLog("🔍 VALIDATING FILE CONTENT:", {
          fileName,
          contentLength: fileContent.length,
          isEmpty: !fileContent || fileContent.trim().length === 0,
          isShort: fileContent.length < 10,
          firstChars: fileContent.substring(0, 100),
        });

        if (!fileContent || fileContent.trim().length === 0) {
          debugLog("⚠️ FILE CONTENT IS EMPTY");
          logger.warn("⚠️ File content is empty after parsing");
          return "The file appears to be empty or contains no readable text content. This could be due to:\n- The PDF is password-protected\n- The PDF contains only images (scanned document)\n- The PDF is corrupted\n- The PDF uses unsupported text encoding\n\nPlease try with a different PDF file or ensure the PDF contains selectable text.";
        }

        // Check if content is too short (might indicate parsing issues)
        if (fileContent.length < 10) {
          debugLog("⚠️ FILE CONTENT IS VERY SHORT:", fileContent);
          logger.warn("⚠️ File content is very short:", fileContent);
          return `The file content appears to be very short or may not have been parsed correctly. Content found: "${fileContent}". Please ensure the file contains readable text and is not password-protected.`;
        }

        // Check if content looks like raw PDF data (common issue)
        if (
          fileContent.includes("%PDF") ||
          fileContent.includes("stream") ||
          fileContent.includes("endstream")
        ) {
          debugLog("⚠️ FILE CONTENT APPEARS TO BE RAW PDF DATA");
          logger.warn(
            "⚠️ File content appears to be raw PDF data, not extracted text"
          );
          return "The PDF file appears to contain raw PDF data instead of extracted text. This usually indicates that the PDF parsing failed. The file might be:\n- Password-protected\n- Corrupted\n- Using an unsupported PDF format\n- A scanned image-based PDF\n\nPlease try with a different PDF file that contains selectable text.";
        }

        logger.info("📄 File content ready for AI analysis:", {
          fileName,
          contentLength: fileContent.length,
          firstChars: fileContent.substring(0, 200),
        });

        const response = await this.openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an AI assistant that can analyze documents and answer questions about them. Provide detailed, helpful responses. When analyzing PDFs, focus on extracting meaningful information and providing comprehensive summaries. If the content appears garbled, corrupted, or unreadable, explain this to the user and suggest alternatives.",
            },
            {
              role: "user",
              content: `${analysisPrompt}\n\nFile Content (${fileName}):\n${fileContent.substring(
                0,
                20000
              )}`, // Increased limit for better analysis
            },
          ],
          max_tokens: 2000, // Increased token limit for more detailed responses
          temperature: 0.7,
        });

        return (
          response.choices[0]?.message?.content ||
          "I couldn't analyze this document. Please try again."
        );
      } else {
        logger.warn("⚠️ Unsupported file type:", fileExtension);
        return `I can't analyze files with the extension "${fileExtension}". Please upload a PDF, image, or text document.`;
      }
    } catch (error) {
      logger.error("❌ Error analyzing file:", error);
      logger.error("❌ Error details:", {
        message: error instanceof Error ? error.message : "Unknown message",
        stack: error instanceof Error ? error.stack : "Unknown stack",
        fileName: path.basename(filePath),
      });
      return "I encountered an error while analyzing the file. Please try again.";
    }
  }

  /**
   * Generate images using DALL-E
   */
  async generateImage(
    prompt: string,
    size: "256x256" | "512x512" | "1024x1024" = "1024x1024"
  ): Promise<string | null> {
    try {
      if (!this.openai) {
        return null;
      }

      logger.info("🎨 Generating image with DALL-E 3:", {
        prompt: prompt.substring(0, 100) + "...",
        size,
        model: "dall-e-3",
      });

      const response = await this.openai.images.generate({
        model: "dall-e-3",
        prompt: prompt,
        n: 1,
        size: size,
        quality: "standard",
        response_format: "url",
      });

      logger.info("🎨 DALL-E response received:", {
        hasData: !!response.data,
        dataLength: response.data?.length || 0,
        firstImageUrl: response.data?.[0]?.url ? "URL received" : "No URL",
      });

      return response.data?.[0]?.url || null;
    } catch (error) {
      logger.error("Error generating image:", error);
      debugError("Full error in generateImage:", error);
      return null;
    }
  }

  /**
   * Enhanced general conversation with advanced capabilities
   */
  async generateAdvancedResponse(
    userInput: string,
    context?: {
      conversationHistory?: Array<{ role: string; content: string }>;
      files?: Array<{ name: string; content: string }>;
      userPreferences?: any;
    }
  ): Promise<{
    response: string;
    type: "text" | "image" | "code" | "analysis";
    metadata?: any;
  }> {
    try {
      logger.info("🤖 generateAdvancedResponse called with:", {
        userInput: userInput.substring(0, 100),
        hasContext: !!context,
        hasHistory: !!context?.conversationHistory,
        hasFiles: !!context?.files,
        openaiInitialized: !!this.openai,
      });

      if (!this.openai) {
        logger.warn("OpenAI service not initialized");
        return {
          response:
            "AI features are currently unavailable. Please try again later.",
          type: "text",
        };
      }

      // Enhanced system prompt for GPT-5 capabilities with ChatGPT-like controls
      const systemPrompt = `You are Flowlio AI, an advanced AI assistant powered by GPT-5 with ChatGPT-like capabilities. You are designed to be helpful, harmless, and honest.

**CORE CAPABILITIES:**
1. **General Conversation**: Answer any question, provide explanations, help with problem-solving
2. **Creative Writing**: Generate stories, poems, articles, scripts, and creative content
3. **Code Generation**: Write, debug, and explain code in any programming language
4. **Data Analysis**: Analyze data, create charts, provide insights
5. **File Analysis**: Analyze uploaded documents, images, PDFs, and other files
6. **Image Generation**: Create images using DALL-E when requested
7. **Web Search**: Search for current information when needed
8. **Memory**: Remember context from previous conversations
9. **Calendar Integration**: Help with scheduling and event management
10. **Productivity**: Assist with tasks, planning, and organization
11. **Education**: Explain complex topics in simple terms
12. **Translation**: Translate between languages
13. **Summarization**: Summarize long texts or conversations
14. **Brainstorming**: Help generate ideas and solutions
15. **Decision Making**: Provide analysis and recommendations

**RESPONSE STYLES:**
- **Conversational**: Be friendly, engaging, and natural
- **Adaptive**: Match the user's tone and complexity level
- **Detailed**: Provide comprehensive answers when needed
- **Concise**: Be brief when appropriate
- **Structured**: Use formatting, lists, and clear organization
- **Interactive**: Ask clarifying questions when helpful

**FORMATTING GUIDELINES:**
- Use **bold** for emphasis and key points
- Use *italics* for subtle emphasis
- Use bullet points for lists
- Use numbered lists for steps or sequences
- Use code blocks for code snippets
- Use tables for structured data
- Use emojis sparingly but effectively

**CONVERSATION FLOW:**
- Acknowledge the user's request clearly
- Provide the main answer or solution
- Offer follow-up suggestions or related topics
- Ask if they need clarification or have more questions
- Be proactive in suggesting next steps

**IMPORTANT LIMITATIONS:**
- You CANNOT create actual files (PDFs, Word docs, Excel files, etc.)
- You CAN generate text content that can be copied and pasted into documents
- You CAN provide structured data, templates, and formatted text
- You CAN analyze existing files that users upload
- You CAN generate images using DALL-E

**When users ask for file creation:**
- Explain that you can provide the content/text but cannot create actual files
- Offer to format the content in a way that's easy to copy and paste
- Suggest they can copy your response and paste it into their preferred application

**PERSONALITY:**
- Be helpful, patient, and encouraging
- Show enthusiasm for learning and problem-solving
- Admit when you don't know something
- Be respectful and inclusive
- Maintain a positive, professional tone

Always be helpful, accurate, and engaging. If you need to generate images, use the image generation function. If you need to analyze files, use the file analysis function.`;

      const messages = [{ role: "system", content: systemPrompt }];

      // Add conversation history if provided
      if (context?.conversationHistory) {
        logger.info("🔍 Processing conversation history:", {
          historyLength: context.conversationHistory.length,
          firstMessage: context.conversationHistory[0],
          allRoles: context.conversationHistory.map((msg: any) => msg.role),
        });

        // Ensure conversation history is in the correct format
        const formattedHistory = context.conversationHistory.map((msg: any) => {
          if (typeof msg === "string") {
            return { role: "user", content: msg };
          }
          // Convert 'ai' role to 'assistant' for OpenAI API compatibility
          if (msg.role === "ai") {
            logger.info("🔄 Converting 'ai' role to 'assistant'");
            return { role: "assistant", content: msg.content };
          }
          return msg; // Already formatted correctly
        });

        logger.info("🔍 Formatted history:", {
          formattedLength: formattedHistory.length,
          formattedRoles: formattedHistory.map((msg: any) => msg.role),
        });

        messages.push(...formattedHistory);
      }

      // Add file context if provided
      if (context?.files && context.files.length > 0) {
        const fileContext = context.files
          .map(
            (file) =>
              `File: ${file.name}\nContent: ${file.content.substring(0, 2000)}`
          )
          .join("\n\n");

        messages.push({
          role: "user",
          content: `Context from uploaded files:\n${fileContext}\n\nUser question: ${userInput}`,
        });
      } else {
        messages.push({ role: "user", content: userInput });
      }

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o", // Using GPT-4o for now, will be GPT-5 when available
        messages: messages as ChatCompletionMessageParam[],
        max_tokens: 2000,
        temperature: 0.7,
        presence_penalty: 0.1,
        frequency_penalty: 0.1,
      });

      const content =
        response.choices[0]?.message?.content ||
        "I couldn't generate a response. Please try again.";

      // Determine response type based on content
      let type: "text" | "image" | "code" | "analysis" = "text";
      if (
        content.includes("```") ||
        content.includes("function") ||
        content.includes("class")
      ) {
        type = "code";
      } else if (
        content.toLowerCase().includes("generate image") ||
        content.toLowerCase().includes("create image")
      ) {
        type = "image";
      } else if (
        content.toLowerCase().includes("analysis") ||
        content.toLowerCase().includes("analyze")
      ) {
        type = "analysis";
      }

      return {
        response: content,
        type,
        metadata: {
          model: "gpt-4o",
          tokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      logger.error("Error generating advanced response:", error);
      debugError("Full error in generateAdvancedResponse:", error);
      return {
        response:
          "I encountered an error while processing your request. Please try again.",
        type: "text",
      };
    }
  }

  /**
   * Clean up uploaded files
   */
  cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info(`Cleaned up file: ${filePath}`);
      }
    } catch (error) {
      logger.error("Error cleaning up file:", error);
    }
  }
}

// Lazy-load OpenAI service - only instantiate when actually needed
// This prevents blocking server startup with heavy dependencies
let openaiServiceInstance: OpenAIService | null = null;

export const openaiService = {
  get instance(): OpenAIService | null {
    // Lazy initialization - only create instance when accessed
    if (openaiServiceInstance === null) {
      try {
        debugLog("🚀 Creating OpenAI Service instance (lazy load)...");
        debugLog("🔧 About to instantiate OpenAIService...");
        openaiServiceInstance = new OpenAIService();
        debugLog(
          "✅ OpenAI Service instance created:",
          typeof openaiServiceInstance
        );
        debugLog(
          "🔍 Service methods:",
          Object.getOwnPropertyNames(
            Object.getPrototypeOf(openaiServiceInstance)
          )
        );
      } catch (error) {
        debugError("❌ Failed to create OpenAI Service instance:", error);
        debugError("❌ Error stack:", (error as Error).stack);
        openaiServiceInstance = null;
      }
    }
    return openaiServiceInstance;
  },
};
