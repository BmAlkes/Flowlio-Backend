import "module-alias/register";
import { assignSocketToReqIO } from "@/middlewares/socket.middleware";
import { connAuthBridge } from "@/middlewares/socket.middleware";
import { prepareMigration } from "./utils/preparemigration.util";
import { throttle } from "./middlewares/throttle.middleware";
import { registerEvents } from "@/utils/registerevents.util";
import { authActivityMiddleware } from "@/middlewares/auth-activity.middleware";
import superAdminRoutes from "./routes/superadmin.routes";
import userProfileRoutes from "./routes/userprofile.routes";
import unknownRoutes from "@/routes/unknown.routes";
import { swagger } from "@/configs/swagger.config";
import { toNodeHandler } from "better-auth/node";
import { logger } from "@/utils/logger.util";
import cors, { CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import { env } from "./utils/env.util";
import { createServer } from "http";
import { Server } from "socket.io";
import "@/types/declaration.types";
import { auth } from "./lib/auth";
import { config } from "dotenv";
import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import organizationRoutes from "./routes/organization.routes";
import paymentRoutes from "./routes/payment.routes";
import subscriptionRoutes from "./routes/subscription.routes";
import clientRoutes from "./routes/client.routes";
import projectRoutes from "./routes/project.routes";
import taskRoutes from "./routes/task.routes";
import calendarEventsRoutes from "./routes/calendar-events.routes";
import paymentLinksRoutes from "./routes/payment-links.routes";
import invoicesRoutes from "./routes/invoices.routes";
import universalSupportTicketRoutes from "./routes/universalsupportticket.routes";
import viewerRoutes from "./routes/viewer.routes";
import googleCalendarRoutes from "./routes/googleCalendar.routes";
import aiRoutes from "./routes/ai.routes";
import notificationRoutes from "./routes/notifications.routes";
import newsletterRoutes from "./routes/newsletter.routes";
import { backgroundSyncService } from "./services/backgroundSync.service";
import { autoRenewalService } from "./services/autoRenewal.service";

config();
const app = express();
const httpServer = createServer(app);
const port = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === "production";
const isRailway =
  process.env.RAILWAY_ENVIRONMENT === "production" ||
  !!process.env.RAILWAY_PROJECT_ID;

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const frontendDomain = env.FRONTEND_DOMAIN;
    const allowedOrigins = [
      frontendDomain,
      frontendDomain.endsWith("/")
        ? frontendDomain.slice(0, -1)
        : frontendDomain,
      frontendDomain.endsWith("/") ? frontendDomain : frontendDomain + "/",
      // Add common localhost variations for development
      "http://localhost:3000",
      "http://localhost:4000",
      "http://localhost:4001",
      // Add production frontend URL
      "https://flowlioapp.com",
      "https://flowlioapp.com/",
    ];

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    logger.info(`CORS blocked origin: ${origin}`);
    logger.info(`Allowed domains: ${allowedOrigins.join(", ")}`);
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Cache-Control",
    "Pragma",
  ],
};

const io = new Server(httpServer, {
  cors: corsOptions,
});

swagger(app);
// Run migration asynchronously to avoid blocking server startup
// Migration will run in the background and won't prevent server from starting
prepareMigration(isProduction || isRailway).catch((error) => {
  logger.error("Migration error (non-blocking):", error);
});

app.use(helmet());
io.on("connection", registerEvents);
app.use(express.static("public"));
app.use(assignSocketToReqIO(io));
app.use(express.static("dist"));
app.use(cors(corsOptions));
app.use(cookieParser());
io.use(connAuthBridge);

app.use(morgan(isProduction || isRailway ? "combined" : "dev"));

// Add request logging for auth endpoints (only in development)
if (!isProduction && !isRailway) {
  app.use("/api/auth", (req, _, next) => {
    logger.info(`Auth request: ${req.method} ${req.path}`);
    logger.info(`Origin: ${req.headers.origin}`);
    next();
  });
}

// Database health check endpoint
app.get("/api/health/db", async (_, res) => {
  try {
    const { connection } = await import("@/configs/connection.config");
    const client = await connection.connect();
    await client.query("SELECT NOW()");
    client.release();

    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
      message: "Database connection successful",
    });
  } catch (error) {
    logger.error("Database health check failed:", error);
    res.status(503).json({
      status: "unhealthy",
      database: "disconnected",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// Mount better-auth handler with activity logging wrapper
app.all("/api/auth/*splat", (req, res) => {
  // Wrap the response to intercept successful auth operations
  authActivityMiddleware(req, res, () => {
    // After middleware sets up interceptors, call the auth handler
    toNodeHandler(auth)(req, res);
  });
});

// enable after database connection
app.use(throttle("default"));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use("/api/superadmin", superAdminRoutes);
app.use("/api/user", userProfileRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api", calendarEventsRoutes);
app.use("/api/payment-links", paymentLinksRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/support-tickets", universalSupportTicketRoutes);
app.use("/api/viewer", viewerRoutes);
app.use("/api/google-calendar", googleCalendarRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use(unknownRoutes);

httpServer.listen(port as number, () => {
  logger.info(`Server is running on port ${port}`);

  // Start background sync service asynchronously after server starts
  // This prevents blocking the server startup
  setImmediate(() => {
    if (isProduction || env.ENABLE_BACKGROUND_SYNC === "false") {
      // Delay initial sync to avoid blocking startup
      setTimeout(() => {
        backgroundSyncService.startPeriodicSync(60); // Sync every 60 minutes instead of 15
        logger.info("Background sync service started (60min interval)");
      }, 5000); // Start sync 5 seconds after server starts
    } else {
      logger.info("Background sync service disabled in development mode");
    }
  });

  // Start auto-renewal service asynchronously after server starts
  // This checks for expiring subscriptions and auto-renews them
  setImmediate(() => {
    // Delay initial check to avoid blocking startup
    setTimeout(() => {
      autoRenewalService.startPeriodicRenewal(24); // Check every 24 hours (once per day)
      logger.info("Auto-renewal service started (24h interval)");
    }, 10000); // Start 10 seconds after server starts
  });
});
