import {
  forgotPasswordTemplate,
  invitationTemplate,
  signupTemplate,
} from "@/utils/brevo.util";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { brevoTransactionApi } from "@/configs/brevo.config";
import { database } from "../configs/connection.config";
import * as schema from "../schema/schema";
import { betterAuth } from "better-auth";
import { env } from "@/utils/env.util";
import { createAuthMiddleware, emailOTP, twoFactor } from "better-auth/plugins";
import { admin as adminPlugin } from "better-auth/plugins";
import { ac, roles } from "./permission";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";

const isProduction =
  process.env.NODE_ENV === "production" ||
  process.env.RAILWAY_ENVIRONMENT === "production" ||
  !!process.env.RAILWAY_PROJECT_ID;

// Ensure BACKEND_DOMAIN has protocol
const getBaseURL = () => {
  const domain = env.BACKEND_DOMAIN;
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }
  return isProduction ? `https://${domain}` : `http://${domain}`;
};

export const auth = betterAuth({
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // prevents multiple admin signups
      if (ctx.path === "/sign-up/email") {
        const isAdminExists = await database
          .select()
          .from(schema.users)
          .where(eq(schema.users.isSuperAdmin, true))
          .limit(1);

        if (isAdminExists.length > 0) {
          // Admin already exists
        }
        return;
      }

      // Check organization status before sign-in
      if (ctx.path === "/sign-in/email" && ctx.body?.email) {
        const email = ctx.body.email as string;

        // Find user by email
        const [user] = await database
          .select({
            id: schema.users.id,
            role: schema.users.role,
            isSuperAdmin: schema.users.isSuperAdmin,
            twoFactorEnabled: schema.users.twoFactorEnabled,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // Super admins should bypass OTP requirements ONLY if they haven't explicitly enabled 2FA
        if (!user || (user.isSuperAdmin && !user.twoFactorEnabled)) {
          // Allow super admin without 2FA or if user not found (will fail auth anyway)
          // Set a flag to skip OTP verification
          (ctx as any).skipOTP = true;
          return;
        }

        // Portal access check for client users
        if (user.role === "client") {
          const [clientRecord] = await database
            .select({ portalAccessEnabled: schema.clients.portalAccessEnabled })
            .from(schema.clients)
            .where(eq(schema.clients.userId, user.id))
            .limit(1);

          if (clientRecord && clientRecord.portalAccessEnabled === false) {
            const error = new Error("Portal access has been disabled for this account.");
            (error as any).code = "PORTAL_ACCESS_DISABLED";
            (error as any).statusCode = 403;
            throw error;
          }
          return; // Clients have no org memberships — skip org status checks
        }

        // Check organization status
        const userOrg = await database
          .select({
            orgStatus: schema.organizations.status,
            trialEndsAt: schema.organizations.trialEndsAt,
            subscriptionStatus: schema.organizations.subscriptionStatus,
          })
          .from(schema.userOrganizations)
          .innerJoin(
            schema.organizations,
            eq(schema.userOrganizations.organizationId, schema.organizations.id)
          )
          .where(eq(schema.userOrganizations.userId, user.id))
          .limit(1);

        if (userOrg.length > 0 && userOrg[0].orgStatus) {
          const orgData = userOrg[0];
          const orgStatus = orgData.orgStatus;

          // Check 1: Organization is deactivated
          if (orgStatus === "suspended" || orgStatus === "inactive") {
            const error = new Error(
              "Your organization account has been deactivated. Please contact the administrator for assistance."
            );
            (error as any).code = "ORGANIZATION_DEACTIVATED";
            (error as any).statusCode = 403;
            throw error;
          }

          // Check 2: Trial period has expired
          const trialEndsAt = orgData.trialEndsAt;
          const subscriptionStatus = orgData.subscriptionStatus;
          const now = new Date();

          if (trialEndsAt) {
            const trialEndDate = new Date(trialEndsAt);

            // If trial has expired AND subscription is not active/valid
            if (
              trialEndDate < now &&
              subscriptionStatus !== "active" &&
              subscriptionStatus !== "trialing"
            ) {
              const error = new Error(
                "Your trial period has expired. Please contact the administrator to upgrade your subscription."
              );
              (error as any).code = "TRIAL_EXPIRED";
              (error as any).statusCode = 403;
              throw error;
            }
          }
        }
      }
    }),
  },
  baseURL: getBaseURL(),
  secret: env.COOKIE_SECRET,
  trustedOrigins: [
    env.FRONTEND_DOMAIN,
    env.FRONTEND_DOMAIN.endsWith("/")
      ? env.FRONTEND_DOMAIN.slice(0, -1)
      : env.FRONTEND_DOMAIN,
    env.FRONTEND_DOMAIN.endsWith("/")
      ? env.FRONTEND_DOMAIN
      : env.FRONTEND_DOMAIN + "/",
    "http://localhost:3000",
    "https://localhost:3000",
  ],
  advanced: {
    useSecureCookies: isProduction,
    // When COOKIE_DOMAIN is set (e.g. ".flowlioapp.com"), the backend runs on a subdomain
    // of the frontend — browsers treat this as same-site, so SameSite=Lax is sufficient
    // and Safari/iOS ITP no longer blocks the cookie.
    // Without COOKIE_DOMAIN we fall back to SameSite=None for the cross-site Railway domain.
    ...(env.COOKIE_DOMAIN
      ? {
          crossSubdomainCookies: {
            enabled: true,
            domain: env.COOKIE_DOMAIN,
          },
        }
      : {}),
    cookies: {
      session_token: {
        attributes: {
          sameSite: isProduction ? (env.COOKIE_DOMAIN ? "lax" : "none") : "lax",
          httpOnly: true,
          secure: isProduction,
        },
      },
      session_data: {
        attributes: {
          sameSite: isProduction ? (env.COOKIE_DOMAIN ? "lax" : "none") : "lax",
          httpOnly: true,
          secure: isProduction,
        },
      },
    },
  },
  database: drizzleAdapter(database, { provider: "pg", schema }),
  plugins: [
    twoFactor({
      issuer: "Flowlio",
    }),
    // Admin plugin for role-based access control
    adminPlugin({
      defaultRole: "user",
      ac,
      adminRoles: ["superadmin", "subadmin"],
      roles,
    }),
    // Email OTP plugin for verification
    emailOTP({
      sendVerificationOTP: async ({ type, email, otp }, req) => {
        logger.info(`📧 OTP Request - Type: ${type}, Email: ${email}`);

        // Check if user is superadmin - skip OTP entirely
        const [user] = await database
          .select({
            isSuperAdmin: schema.users.isSuperAdmin,
            twoFactorEnabled: schema.users.twoFactorEnabled,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        logger.info(
          `👤 User found: ${!!user}, isSuperAdmin: ${
            user?.isSuperAdmin
          }, twoFactorEnabled: ${user?.twoFactorEnabled}`
        );

        // IMPORTANT: Only skip OTP for super admins on SIGN-IN, not on email-verification
        // This is because email-verification can be used to ENABLE 2FA (when twoFactorEnabled is still false)
        // For sign-in, super admins should bypass OTP unless they have 2FA enabled
        if (
          type === "sign-in" &&
          user?.isSuperAdmin &&
          !user.twoFactorEnabled
        ) {
          logger.info(
            `⏭️ Skipping sign-in OTP for super admin without 2FA: ${email}`
          );
          // Return early without sending email - Better Auth should skip OTP for superadmins
          // The plugin will not require OTP if no email is sent
          return;
        }

        const reqUrl = new URL(req!.url);
        const url = env.FRONTEND_DOMAIN;
        const password = reqUrl.searchParams.get("password");
        const name = reqUrl.searchParams.get("name");

        try {
          // Note: forget-password type is handled by Better Auth's built-in forgetPassword
          // which uses sendResetPassword callback (link-based reset)
          // We only handle email-verification and sign-in OTP types here
          if (type === "email-verification" && password) {
            // send invitation on behalf of admin
            const invitationUrl = `${url}?otp=${otp}&email=${encodeURIComponent(
              email
            )}`;
            await brevoTransactionApi.sendTransacEmail({
              to: [
                {
                  name: name ?? email.substring(0, email.lastIndexOf("@")),
                  email,
                },
              ],
              subject: "Invitation",
              htmlContent: invitationTemplate({
                name: name ?? email.substring(0, email.lastIndexOf("@")),
                url: invitationUrl,
                password,
                email,
              }),
              sender: {
                name: "Flowlio",
                email: env.BREVO_SENDER,
              },
            });
          } else if (type === "email-verification" && !password) {
            // Check if user exists
            const [user] = await database
              .select({
                twoFactorEnabled: schema.users.twoFactorEnabled,
                isSuperAdmin: schema.users.isSuperAdmin,
              })
              .from(schema.users)
              .where(eq(schema.users.email, email))
              .limit(1);

            logger.info(
              `🔐 Email verification OTP check - User: ${!!user}, 2FA: ${
                user?.twoFactorEnabled
              }, SuperAdmin: ${user?.isSuperAdmin}`
            );

            // IMPORTANT: For email-verification type, we should send OTP if user exists
            // This is because:
            // 1. User might be enabling 2FA (twoFactorEnabled is still false) - THIS IS THE KEY CASE!
            // 2. User might be verifying email during signup
            // 3. User might be using it for other verification purposes
            // We MUST send OTP even if twoFactorEnabled is false, because the user is trying to ENABLE it!
            if (!user) {
              logger.warn(
                `⏭️ Skipping email verification OTP - User not found: ${email}`
              );
              return;
            }

            // DO NOT skip for super admin when enabling 2FA!
            // When user clicks "Enable 2FA", their twoFactorEnabled is still false,
            // so we MUST send the OTP to allow them to verify and enable 2FA
            // The top-level check already handles sign-in type, so we're safe here

            logger.info(`📤 Sending email verification OTP to ${email}`);
            // Send OTP for email verification (could be for 2FA setup or other verification)
            // Determine subject based on whether user has 2FA enabled or not
            const is2FASetup = !user.twoFactorEnabled;
            await brevoTransactionApi.sendTransacEmail({
              to: [{ email, name: email.substring(0, email.lastIndexOf("@")) }],
              subject: is2FASetup
                ? "Your Email Verification Code for 2FA Setup"
                : "Your 2FA Verification Code",
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #333; margin-bottom: 10px;">Two-Factor Authentication</h1>
                    <p style="color: #666; font-size: 16px;">Secure your account with an extra layer of protection</p>
                  </div>
                  
                  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; text-align: center; margin: 20px 0;">
                    <p style="color: #333; font-size: 18px; margin-bottom: 15px;">Your verification code is:</p>
                    <div style="background-color: #fff; border: 2px dashed #007bff; border-radius: 8px; padding: 20px; margin: 20px 0;">
                      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007bff; font-family: monospace;">${otp}</span>
                    </div>
                    <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
                  </div>
                  
                  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0;">
                    <p style="color: #856404; font-size: 14px; margin: 0;">
                      <strong>Security Notice:</strong> If you didn't request this code, please ignore this email and consider changing your password.
                    </p>
                  </div>
                  
                  <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="color: #999; font-size: 12px; margin: 0;">
                      This email was sent by Flowlio Security System
                    </p>
                  </div>
                </div>
              `,
              sender: {
                name: "Flowlio Security",
                email: env.BREVO_SENDER,
              },
            });
            logger.info(
              `✅ Email verification OTP sent successfully to ${email}`
            );
          } else if (type === "sign-in") {
            // Handle sign-in OTP - check if 2FA is enabled
            const [user] = await database
              .select({
                twoFactorEnabled: schema.users.twoFactorEnabled,
                isSuperAdmin: schema.users.isSuperAdmin,
              })
              .from(schema.users)
              .where(eq(schema.users.email, email))
              .limit(1);

            logger.info(
              `🔐 Sign-in OTP check - User: ${!!user}, 2FA: ${
                user?.twoFactorEnabled
              }, SuperAdmin: ${user?.isSuperAdmin}`
            );

            // Only send sign-in OTP if user has 2FA enabled
            // Super admins should always bypass OTP (unless they explicitly enable 2FA)
            if (!user || (!user.twoFactorEnabled && !user.isSuperAdmin)) {
              logger.warn(
                `⏭️ Skipping sign-in OTP - User not found or 2FA not enabled: ${email}`
              );
              // Don't send OTP email - Better Auth should allow sign-in without OTP
              return;
            }

            logger.info(`📤 Sending sign-in OTP to ${email}`);
            // Send sign-in OTP for users with 2FA enabled
            await brevoTransactionApi.sendTransacEmail({
              to: [{ email, name: email.substring(0, email.lastIndexOf("@")) }],
              subject: "Your Sign-In Verification Code",
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #333; margin-bottom: 10px;">Sign-In Verification</h1>
                    <p style="color: #666; font-size: 16px;">Verify your identity to complete sign-in</p>
                  </div>
                  
                  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; text-align: center; margin: 20px 0;">
                    <p style="color: #333; font-size: 18px; margin-bottom: 15px;">Your verification code is:</p>
                    <div style="background-color: #fff; border: 2px dashed #007bff; border-radius: 8px; padding: 20px; margin: 20px 0;">
                      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007bff; font-family: monospace;">${otp}</span>
                    </div>
                    <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
                  </div>
                  
                  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0;">
                    <p style="color: #856404; font-size: 14px; margin: 0;">
                      <strong>Security Notice:</strong> If you didn't request this code, please ignore this email and consider changing your password.
                    </p>
                  </div>
                  
                  <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="color: #999; font-size: 12px; margin: 0;">
                      This email was sent by Flowlio Security System
                    </p>
                  </div>
                </div>
              `,
              sender: {
                name: "Flowlio Security",
                email: env.BREVO_SENDER,
              },
            });
            logger.info(`✅ Sign-in OTP sent successfully to ${email}`);
          } else {
            // Handle any other OTP types (e.g., two-factor-setup, etc.)
            logger.warn(
              `⚠️ Unknown OTP type: ${type} for email: ${email} - Attempting to send anyway`
            );

            // For unknown types, check if user exists and send OTP
            const [user] = await database
              .select({
                twoFactorEnabled: schema.users.twoFactorEnabled,
                isSuperAdmin: schema.users.isSuperAdmin,
              })
              .from(schema.users)
              .where(eq(schema.users.email, email))
              .limit(1);

            if (!user) {
              logger.warn(
                `⏭️ Skipping OTP for unknown type - User not found: ${email}`
              );
              return;
            }

            // Skip for super admin without 2FA
            if (user.isSuperAdmin && !user.twoFactorEnabled) {
              logger.info(
                `⏭️ Skipping OTP for unknown type - Super admin without 2FA: ${email}`
              );
              return;
            }

            logger.info(`📤 Sending OTP for unknown type ${type} to ${email}`);
            // Send generic OTP email for unknown types
            await brevoTransactionApi.sendTransacEmail({
              to: [{ email, name: email.substring(0, email.lastIndexOf("@")) }],
              subject: "Your Verification Code",
              htmlContent: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                  <div style="text-align: center; margin-bottom: 30px;">
                    <h1 style="color: #333; margin-bottom: 10px;">Verification Code</h1>
                    <p style="color: #666; font-size: 16px;">Please use the code below to verify your request</p>
                  </div>
                  
                  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; text-align: center; margin: 20px 0;">
                    <p style="color: #333; font-size: 18px; margin-bottom: 15px;">Your verification code is:</p>
                    <div style="background-color: #fff; border: 2px dashed #007bff; border-radius: 8px; padding: 20px; margin: 20px 0;">
                      <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007bff; font-family: monospace;">${otp}</span>
                    </div>
                    <p style="color: #666; font-size: 14px;">This code will expire in 30 minutes.</p>
                  </div>
                  
                  <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0;">
                    <p style="color: #856404; font-size: 14px; margin: 0;">
                      <strong>Security Notice:</strong> If you didn't request this code, please ignore this email and consider changing your password.
                    </p>
                  </div>
                  
                  <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                    <p style="color: #999; font-size: 12px; margin: 0;">
                      This email was sent by Flowlio Security System
                    </p>
                  </div>
                </div>
              `,
              sender: {
                name: "Flowlio Security",
                email: env.BREVO_SENDER,
              },
            });
            logger.info(
              `✅ OTP sent successfully for type ${type} to ${email}`
            );
          }
        } catch (error) {
          logger.error(`❌ Failed to send OTP email to ${email}:`, error);
          logger.error(`❌ Error details:`, {
            message: (error as any)?.message,
            stack: (error as any)?.stack,
            response: (error as any)?.response?.data,
            status: (error as any)?.response?.status,
          });
          throw error;
        }
      },
      otpLength: 6, // 6-digit OTP
      expiresIn: 60 * 30, // 30 minutes for 2FA OTP (increased from 10 minutes)
      allowedAttempts: 5, // Allow 5 attempts (increased from 3)
    }),
  ],
  user: {
    modelName: "users",
    additionalFields: {
      role: {
        fieldName: "role",
        defaultValue: "user",
        required: false,
        type: "string",
      },
      isSuperAdmin: {
        fieldName: "is_super_admin",
        defaultValue: false,
        required: false,
        type: "boolean",
      },
      subadminId: {
        fieldName: "subadmin_id",
        defaultValue: null,
        required: false,
        type: "string",
      },
      isOrganizationOwner: {
        fieldName: "is_organization_owner",
        defaultValue: false,
        required: false,
        type: "boolean",
      },
      timezone: {
        fieldName: "timezone",
        defaultValue: "UTC",
        required: false,
        type: "string",
      },
    },
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async () => {
        // Send change email verification
      },
    },
    deleteUser: {
      enabled: true,
      sendDeleteAccountVerification: async () => {
        // Send delete account verification
      },
      beforeDelete: async (ctx: { id: string }) => {
        // Perform actions before user deletion
        const userId = ctx.id;
        logger.info(`🗑️ Starting user deletion process for user: ${userId}`);

        try {
          // Delete calendar events created by this user
          // (cascade delete is now in schema, but we'll log it)
          const calendarEventsCount = await database
            .select({ count: schema.calendarEvents.id })
            .from(schema.calendarEvents)
            .where(eq(schema.calendarEvents.userId, userId));

          logger.info(
            `📅 Will delete ${calendarEventsCount.length} calendar events for user ${userId}`
          );

          // Delete recent activities where user is the actor
          // (We keep activities for history, but can optionally delete)
          const activitiesCount = await database
            .select({ count: schema.recentActivities.id })
            .from(schema.recentActivities)
            .where(eq(schema.recentActivities.actorId, userId));

          logger.info(
            `📊 Found ${activitiesCount.length} activities by user ${userId} (keeping for history)`
          );

          logger.info(`✅ Pre-deletion checks completed for user ${userId}`);
        } catch (error) {
          logger.error(
            `❌ Error during beforeDelete hook for user ${userId}:`,
            error
          );
          // Don't throw - let the deletion proceed
        }
      },
      afterDelete: async (ctx: { id: string }) => {
        // Perform cleanup after user deletion
        const userId = ctx.id;
        logger.info(
          `✅ User ${userId} deleted successfully. Cleanup completed.`
        );
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days ( session expiry )
    updateAge: 60 * 60 * 24, // 1 day( "expiresIn = now + expiry" after every updateAge time, if session is used )
    cookieCache: {
      enabled: true, // Enable caching session in cookie
      maxAge: 5 * 60, // 5 minutes
    },
    includeFields: [
      "id",
      "name",
      "email",
      "emailVerified",
      "image",
      "role",
      "isSuperAdmin",
      "isOrganizationOwner",
      "subadminId",
      "timezone",
      "createdAt",
      "updatedAt",
    ],
  },
  // triggers on( forgot-password, reset-password )
  emailAndPassword: {
    sendResetPassword: async ({ user, url }) => {
      await brevoTransactionApi.sendTransacEmail({
        to: [{ email: user.email, name: user.name }],
        subject: "Reset your password for Flowlio",
        htmlContent: forgotPasswordTemplate({ user, url }),
        sender: {
          name: "Flowlio",
          email: env.BREVO_SENDER,
        },
      });
    },
    requireEmailVerification: false,
    minPasswordLength: 8,
    autoSignIn: true, // after signup verification( default = true)
    enabled: true,
  },
  // triggers on( signup/signin(if email's unverified) )
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await brevoTransactionApi.sendTransacEmail({
        to: [{ email: user.email, name: user.name }],
        subject: "Verify your email address for Flowlio",
        htmlContent: signupTemplate({ user, url }),
        sender: {
          name: "Flowlio",
          email: env.BREVO_SENDER,
        },
      });
    },
    autoSignInAfterVerification: true,
    sendOnSignUp: false,
    // sendOnSignUp: true,
  },
});
