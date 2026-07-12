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

export const taskOverdueTemplate = ({
  assigneeName,
  taskTitle,
  projectName,
  endDate,
  taskUrl,
  fallbackNote,
}: {
  assigneeName: string;
  taskTitle: string;
  projectName: string;
  endDate: string;
  taskUrl?: string;
  fallbackNote?: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #dc2626;">Task Overdue</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${assigneeName}</b>,</p>
      ${fallbackNote ? `
      <div style="background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; color: #92400e;">${fallbackNote}</p>
      </div>
      ` : ""}
      <p style="font-size: 16px; color: #333;">
        The following task is past its due date and has been marked as delayed:
      </p>
      <div style="background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
        <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #1a202c;">${taskTitle}</p>
        <p style="margin: 0 0 4px 0; font-size: 14px; color: #6b7280;">Project: <b>${projectName}</b></p>
        <p style="margin: 0; font-size: 14px; color: #dc2626;">Due date: <b>${endDate}</b></p>
      </div>
      ${taskUrl ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${taskUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 16px; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View Task
        </a>
      </div>
      ` : ""}
      <p style="font-size: 14px; color: #6b7280;">
        Please update the task status or reschedule it as soon as possible to keep the project on track.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
      <p style="font-size: 13px; color: #bbb; text-align: center;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const projectRiskTemplate = ({
  recipientName,
  projectName,
  projectNumber,
  riskScore,
  reasons,
  projectUrl,
}: {
  recipientName: string;
  projectName: string;
  projectNumber: string;
  riskScore: number;
  reasons: string[];
  projectUrl?: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #d97706;">Project at Risk</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${recipientName}</b>,</p>
      <p style="font-size: 16px; color: #333;">
        The following project has been flagged as high risk and requires your attention:
      </p>
      <div style="background: #fffbeb; border-left: 4px solid #d97706; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
        <p style="margin: 0 0 6px 0; font-size: 16px; font-weight: bold; color: #1a202c;">${projectName}</p>
        <p style="margin: 0 0 10px 0; font-size: 13px; color: #6b7280;">#${projectNumber}</p>
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #d97706;">
          Risk Score: <b>${riskScore}/100</b>
        </p>
        ${reasons.length > 0 ? `
        <p style="margin: 0 0 6px 0; font-size: 13px; color: #6b7280; font-weight: bold;">Risk factors:</p>
        <ul style="margin: 0; padding-left: 20px;">
          ${reasons.map((r) => `<li style="font-size: 13px; color: #374151; margin-bottom: 4px;">${r}</li>`).join("")}
        </ul>
        ` : ""}
      </div>
      ${projectUrl ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${projectUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 16px; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View Project
        </a>
      </div>
      ` : ""}
      <p style="font-size: 14px; color: #6b7280;">
        Please review the project and take action to reduce the risk before it impacts the delivery timeline.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
      <p style="font-size: 13px; color: #bbb; text-align: center;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const leadFollowUpTemplate = ({
  recipientName,
  leadName,
  followUpAt,
  businessIndustry,
  leadUrl,
}: {
  recipientName: string;
  leadName: string;
  followUpAt: string;
  businessIndustry?: string | null;
  leadUrl?: string;
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 480px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #d97706;">Overdue Follow-up</h2>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${recipientName}</b>,</p>
      <p style="font-size: 16px; color: #333;">
        A scheduled follow-up with one of your leads is overdue:
      </p>
      <div style="background: #fffbeb; border-left: 4px solid #d97706; border-radius: 8px; padding: 16px 20px; margin: 24px 0;">
        <p style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold; color: #1a202c;">${leadName}</p>
        ${businessIndustry ? `<p style="margin: 0 0 4px 0; font-size: 14px; color: #6b7280;">Industry: <b>${businessIndustry}</b></p>` : ""}
        <p style="margin: 0; font-size: 14px; color: #d97706;">Follow-up was due: <b>${followUpAt}</b></p>
      </div>
      ${leadUrl ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${leadUrl}" style="display: inline-block; background: #2563eb; color: #fff; font-size: 16px; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">
          View Lead
        </a>
      </div>
      ` : ""}
      <p style="font-size: 14px; color: #6b7280;">
        Reach out to ${leadName} as soon as possible to keep the conversation moving forward.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 28px 0;" />
      <p style="font-size: 13px; color: #bbb; text-align: center;">
        &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
      </p>
    </div>
  </div>
`;

export const weeklySummaryTemplate = ({
  recipientName,
  organizationName,
  weekLabel,
  summaryText,
  highlights,
  metrics,
  projectBreakdown,
  recommendations,
}: {
  recipientName: string;
  organizationName: string;
  weekLabel: string;
  summaryText: string;
  highlights: string[];
  metrics: {
    activeProjects: number;
    completedTasks: number;
    totalHours: number;
    billableHours: number;
  };
  projectBreakdown: Array<{
    projectName: string;
    projectNumber: string;
    progress: number;
    tasksCompleted: number;
    tasksInProgress: number;
    tasksPending: number;
    hoursSpent: number;
  }>;
  recommendations: string[];
}) => `
  <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
    <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <img src="${logo}" alt="Flowlio Logo" style="width: 80px; margin-bottom: 8px;" />
        <h2 style="margin: 0; color: #1a202c;">Weekly Summary</h2>
        <p style="margin: 6px 0 0; color: #6b7280; font-size: 14px;">${organizationName} · ${weekLabel}</p>
      </div>
      <p style="font-size: 18px; color: #333;">Hi <b>${recipientName}</b>,</p>
      <p style="font-size: 15px; color: #444; line-height: 1.6;">${summaryText}</p>

      <!-- Metrics grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 24px 0;">
        <div style="background: #f0f9ff; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #0369a1;">${metrics.activeProjects}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Active Projects</div>
        </div>
        <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #16a34a;">${metrics.completedTasks}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Tasks Completed</div>
        </div>
        <div style="background: #faf5ff; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #7c3aed;">${metrics.totalHours.toFixed(1)}h</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Hours Worked</div>
        </div>
        <div style="background: #fff7ed; border-radius: 8px; padding: 16px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #c2410c;">${metrics.billableHours.toFixed(1)}h</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">Billable Hours</div>
        </div>
      </div>

      ${highlights.length > 0 ? `
      <h3 style="color: #1a202c; font-size: 16px; margin: 24px 0 12px;">Highlights</h3>
      <ul style="margin: 0; padding-left: 20px; color: #444; font-size: 15px; line-height: 1.8;">
        ${highlights.map(h => `<li>${h}</li>`).join("")}
      </ul>
      ` : ""}

      ${projectBreakdown.length > 0 ? `
      <h3 style="color: #1a202c; font-size: 16px; margin: 24px 0 12px;">Project Breakdown</h3>
      ${projectBreakdown.map(p => `
        <div style="background: #f9fafb; border-radius: 8px; padding: 14px 16px; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-weight: bold; color: #1a202c; font-size: 15px;">${p.projectName}</span>
            <span style="font-size: 12px; color: #6b7280;">${p.projectNumber}</span>
          </div>
          <div style="background: #e5e7eb; border-radius: 4px; height: 6px; margin-bottom: 8px;">
            <div style="background: #2563eb; border-radius: 4px; height: 6px; width: ${Math.min(100, p.progress)}%;"></div>
          </div>
          <div style="font-size: 13px; color: #6b7280;">
            Progress: <b>${p.progress}%</b> &nbsp;·&nbsp;
            ✅ ${p.tasksCompleted} done &nbsp;·&nbsp;
            🔄 ${p.tasksInProgress} in progress &nbsp;·&nbsp;
            📋 ${p.tasksPending} pending &nbsp;·&nbsp;
            ⏱ ${p.hoursSpent.toFixed(1)}h
          </div>
        </div>
      `).join("")}
      ` : ""}

      ${recommendations.length > 0 ? `
      <h3 style="color: #1a202c; font-size: 16px; margin: 24px 0 12px;">Recommendations</h3>
      <ul style="margin: 0; padding-left: 20px; color: #444; font-size: 15px; line-height: 1.8;">
        ${recommendations.map(r => `<li>${r}</li>`).join("")}
      </ul>
      ` : ""}

      <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
      <p style="font-size: 13px; color: #bbb; text-align: center;">
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
