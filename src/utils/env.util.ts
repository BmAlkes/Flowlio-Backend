import { logger } from "./logger.util";
import { config } from "dotenv";
import { z } from "zod";
config();

const schemaObject = z.object({
  DATABASE_NAME: z.string(),
  CLOUDINARY_API_SECRET: z.string(),
  CLOUDINARY_CLOUD_NAME: z.string(),
  GOOGLE_CLIENT_SECRET: z.string(),
  BETTER_AUTH_SECRET: z.string(),
  CLOUDINARY_API_KEY: z.string(),
  GOOGLE_CLIENT_ID: z.string(),
  FRONTEND_DOMAIN: z.string(),
  CONNECTION_URL: z.string(),
  BACKEND_DOMAIN: z.string(),
  COOKIE_SECRET: z.string(),
  BREVO_API_KEY: z.string(),
  BREVO_SENDER: z.string(),
  BREVO_SENDER_NAME: z.string().optional().default("Flowlio"),
  JWT_SECRET: z.string(),
  GOOGLE_REDIRECT_URI: z.string(),
  OPEN_AI: z.string().optional(),
  ENABLE_BACKGROUND_SYNC: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).optional().default("live"),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  // database: z.string(),
});

const envSchema = schemaObject.safeParse(process.env);

if (!envSchema.success) {
  const message = `Invalid environment variables: ${JSON.stringify(
    envSchema.error.format(),
    null,
    4
  )}`;
  logger.error(message);
  throw new Error(message);
}

export const env = envSchema.data;
