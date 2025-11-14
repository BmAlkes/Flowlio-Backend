import { env } from "./env.util";

// Helper function to ensure URL has protocol
const getBaseURL = (domain: string) => {
  const isProduction = process.env.NODE_ENV === "production";
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain;
  }
  return isProduction ? `https://${domain}` : `http://${domain}`;
};

// Logo URL - ensure protocol is included for email clients
// The logo file should be in backend/public/logowithtext.png
const logo = getBaseURL(env.BACKEND_DOMAIN) + "/logowithtext.png";

export const signupTemplate = ({ user, url }: { user: any; url: string }) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">Welcome to Flowlio!</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${user.name}</b>,</p>
      <p style="font-size: 16px; color: #333;">
        Thank you for signing up for <b>Flowlio</b>! Please verify your email address to activate your account.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${url}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 18px; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          Verify Email
        </a>
      </div>
      <p style="font-size: 15px; color: #555;">
        If you did not request this, you can safely ignore this email.<br>
        This link will expire in <b>1 hour</b>.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const forgotPasswordTemplate = ({
  user,
  url,
}: {
  user: any;
  url: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">Reset Your Password</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${user.name}</b>,</p>
      <p style="font-size: 16px; color: #333;">
        We received a request to reset your password for your <b>Flowlio</b> account. Click the button below to set a new password.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${url}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 18px; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          Reset Password
        </a>
      </div>
      <p style="font-size: 15px; color: #555;">
        If you did not request a password reset, you can safely ignore this email.<br>
        This link will expire in <b>1 hour</b> for your security.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const forgotPasswordCodeTemplate = ({
  user,
  code,
}: {
  user: any;
  code: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">Password Reset Code</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${
        user.name || "User"
      }</b>,</p>
      <p style="font-size: 16px; color: #333;">
        We received a request to reset your password for your <b>Flowlio</b> account. Use the code below to reset your password.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <div style="background: #f8f9fa; border: 2px dashed #1797B9; border-radius: 12px; padding: 24px; margin: 20px 0;">
          <p style="font-size: 14px; color: #666; margin: 0 0 12px 0;">Your verification code:</p>
          <h1 style="color: #1797B9; font-size: 36px; letter-spacing: 8px; margin: 0; font-weight: bold;">${code}</h1>
        </div>
      </div>
      <p style="font-size: 15px; color: #555;">
        Enter this code on the verification page to reset your password.<br>
        This code will expire in <b>15 minutes</b> for your security.
      </p>
      <p style="font-size: 15px; color: #555;">
        If you did not request a password reset, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const invitationTemplate = ({
  password,
  email,
  name,
  url,
}: {
  password: string;
  email: string;
  name: string;
  url: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">You're Invited to Flowlio!</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${name}</b>,</p>
      <p style="font-size: 16px; color: #333;">
        You have been invited to join <b>Flowlio</b>! Click the button below to accept your invitation and get started.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${url}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 18px; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: bold;">Accept Invitation</a>
      </div>
      <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px 0; color: #495057; font-size: 16px;">Your Login Credentials:</h3>
        <p style="margin: 8px 0; color: #6c757d; font-size: 14px;"><strong>Email:</strong> ${email}</p>
        <p style="margin: 8px 0; color: #6c757d; font-size: 14px;"><strong>Password:</strong> ${password}</p>
        <p style="margin: 12px 0 0 0; color: #6c757d; font-size: 13px; font-style: italic;">
          Please keep these credentials safe. You can change your password after logging in.
        </p>
      </div>
      <p style="font-size: 15px; color: #555;">
        If you did not expect this invitation, you can safely ignore this email.<br>
        This link will expire in <b>24 hours</b> for your security.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

function newsletterTemplate({
  subject,
  content,
  unsubscribeUrl,
}: {
  subject: string;
  content: string;
  unsubscribeUrl?: string;
}): string {
  return `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">${subject}</h2>
      </div>
      <div style="font-size: 16px; color: #333; line-height: 1.6;">
        ${content.replace(/\n/g, "<br>")}
      </div>
      ${
        unsubscribeUrl
          ? `
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 12px; color: #888; text-align: center;">
        <a href="${unsubscribeUrl}" style="color: #666; text-decoration: underline;">Unsubscribe from this newsletter</a>
      </p>
      `
          : ""
      }
      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 14px; color: #888;">
        Need help? Contact our support team at <a href="mailto:info@dotvizion.com" style="color: #2563eb;">info@dotvizion.com</a>.
      </p>
      <p style="font-size: 13px; color: #bbb; text-align: center; margin-top: 24px;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;
}

export { newsletterTemplate };
