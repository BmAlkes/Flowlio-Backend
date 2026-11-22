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
  // Public HTTPS URL of /api/google-calendar/webhook. When unset, calendars sync on the schedule only.
  GOOGLE_CALENDAR_WEBHOOK_URL: z.string().url().optional(),
  // WhatsApp Cloud API. Lio on WhatsApp stays off until all four are set.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).optional().default("live"),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  // Set to root domain (e.g. ".flowlioapp.com") when backend runs on a subdomain of the frontend.
  // Enables same-site cookie sharing and removes the need for SameSite=None.
  COOKIE_DOMAIN: z.string().optional(),
  // LGPD: inbox that receives data subject requests that need a person (e.g. organization owner deletion).
  PRIVACY_CONTACT_EMAIL: z.string().email().optional(),
  // Reply-to address of follow-up emails people can answer (e.g. unfinished signups).
  SUPPORT_EMAIL: z.string().email().optional().default("info@dotvizion.com"),
  // Key for OAuth tokens at rest. Falls back to BETTER_AUTH_SECRET; changing it forces Google Calendar reconnects.
  TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  // "true" turns on the 90-day deletion of inactive organizations (warning email at day 75). Off by default.
  ORG_AUTO_DELETE_ENABLED: z.enum(["true", "false"]).optional(),
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
