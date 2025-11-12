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

const isProduction = process.env.NODE_ENV === "production";

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
            isSuperAdmin: schema.users.isSuperAdmin,
            twoFactorEnabled: schema.users.twoFactorEnabled,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // Super admins should always bypass OTP requirements
        if (!user || user.isSuperAdmin) {
          // Allow super admin or if user not found (will fail auth anyway)
          // Super admins don't need OTP unless they explicitly enable 2FA
          // Set a flag to skip OTP verification
          (ctx as any).skipOTP = true;
          return;
        }

        // If user doesn't have 2FA enabled, they should not be required to provide OTP
        // The emailOTP plugin will check twoFactorEnabled before sending OTP

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
    useSecureCookies: isProduction, // required for HTTPS domains
    cookies: {
      session_token: {
        attributes: {
          sameSite: isProduction ? "none" : "lax", // 'lax' for dev, 'none' for prod
          httpOnly: false, // Allow JavaScript access for better debugging
          secure: isProduction, // false for dev, true for prod
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
        // Check if user is superadmin - skip OTP entirely
        const [user] = await database
          .select({
            isSuperAdmin: schema.users.isSuperAdmin,
            twoFactorEnabled: schema.users.twoFactorEnabled,
          })
          .from(schema.users)
          .where(eq(schema.users.email, email))
          .limit(1);

        // Super admins should bypass OTP unless they explicitly enable 2FA
        if (user?.isSuperAdmin && !user.twoFactorEnabled) {
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
            // Check if user has 2FA enabled before sending OTP
            const [user] = await database
              .select({
                twoFactorEnabled: schema.users.twoFactorEnabled,
                isSuperAdmin: schema.users.isSuperAdmin,
              })
              .from(schema.users)
              .where(eq(schema.users.email, email))
              .limit(1);

            // Only send 2FA OTP if user has 2FA enabled
            // Super admins should always bypass OTP (unless they explicitly enable 2FA)
            if (!user || (!user.twoFactorEnabled && !user.isSuperAdmin)) {
              // Don't send OTP email - Better Auth should allow sign-in without OTP
              // when emailOTP callback returns without sending email
              return;
            }

            // Send 2FA OTP for existing users with 2FA enabled
            await brevoTransactionApi.sendTransacEmail({
              to: [{ email, name: email.substring(0, email.lastIndexOf("@")) }],
              subject: "Your 2FA Verification Code",
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

            // Only send sign-in OTP if user has 2FA enabled
            // Super admins should always bypass OTP (unless they explicitly enable 2FA)
            if (!user || (!user.twoFactorEnabled && !user.isSuperAdmin)) {
              // Don't send OTP email - Better Auth should allow sign-in without OTP
              return;
            }

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
          } else {
            return;
          }
        } catch (error) {
          console.error(`❌ Failed to send email to ${email}:`, error);
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
      beforeDelete: async () => {
        // Perform actions before user deletion
      },
      afterDelete: async () => {
        // Perform cleanup after user deletion
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
