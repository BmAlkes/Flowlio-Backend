import { brevoTransactionApi } from "@/configs/brevo.config";
import {
  taskOverdueTemplate,
  projectRiskTemplate,
  leadFollowUpTemplate,
  weeklySummaryTemplate,
} from "@/utils/brevo.util";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";

export type TransactionalTemplateKey =
  | "task_overdue"
  | "project_risk"
  | "lead_follow_up"
  | "weekly_summary";

interface TaskOverdueData {
  assigneeName: string;
  taskTitle: string;
  projectName: string;
  endDate: string;
  taskUrl?: string;
  fallbackNote?: string;
}

interface ProjectRiskData {
  recipientName: string;
  projectName: string;
  projectNumber: string;
  riskScore: number;
  reasons: string[];
  projectUrl?: string;
}

interface LeadFollowUpData {
  recipientName: string;
  leadName: string;
  followUpAt: string;
  businessIndustry?: string | null;
  leadUrl?: string;
}

interface WeeklySummaryData {
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
}

type TemplateDataMap = {
  task_overdue: TaskOverdueData;
  project_risk: ProjectRiskData;
  lead_follow_up: LeadFollowUpData;
  weekly_summary: WeeklySummaryData;
};

export interface EmailResult {
  success: boolean;
  to: string;
  messageId?: string;
  error?: string;
}

function buildHtml<K extends TransactionalTemplateKey>(
  templateKey: K,
  data: TemplateDataMap[K],
): string {
  switch (templateKey) {
    case "task_overdue":
      return taskOverdueTemplate(data as TaskOverdueData);
    case "project_risk":
      return projectRiskTemplate(data as ProjectRiskData);
    case "lead_follow_up":
      return leadFollowUpTemplate(data as LeadFollowUpData);
    case "weekly_summary":
      return weeklySummaryTemplate(data as WeeklySummaryData);
    default:
      throw new Error(`Unknown email template: ${templateKey}`);
  }
}

function buildSubject(templateKey: TransactionalTemplateKey, data: any): string {
  switch (templateKey) {
    case "task_overdue":
      return `[Flowlio] Task overdue: ${data.taskTitle}`;
    case "project_risk":
      return `[Flowlio] Project at risk: ${data.projectName} (score ${data.riskScore}/100)`;
    case "lead_follow_up":
      return `[Flowlio] Overdue follow-up: ${data.leadName}`;
    case "weekly_summary":
      return `[Flowlio] Weekly summary: ${data.weekLabel}`;
    default:
      return "Flowlio Notification";
  }
}

export async function sendTransactionalEmail<K extends TransactionalTemplateKey>({
  to,
  toName,
  templateKey,
  data,
}: {
  to: string;
  toName?: string;
  templateKey: K;
  data: TemplateDataMap[K];
}): Promise<EmailResult> {
  if (!env.BREVO_SENDER) {
    const error = "BREVO_SENDER env variable is not configured";
    logger.error(`sendTransactionalEmail: ${error}`);
    return { success: false, to, error };
  }

  const htmlContent = buildHtml(templateKey, data);
  const subject = buildSubject(templateKey, data);

  logger.info(`sendTransactionalEmail: sending [${templateKey}] to ${to} from ${env.BREVO_SENDER}`);

  try {
    const response = await brevoTransactionApi.sendTransacEmail({
      to: [{ email: to, name: toName ?? to }],
      subject,
      htmlContent,
      sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER },
    });

    const body = (response as any)?.body ?? response;
    const messageId: string | undefined = body?.messageId;
    const statusCode: number = (response as any)?.response?.statusCode ?? 201;

    logger.info(`sendTransactionalEmail: success [${templateKey}] → ${to}`, {
      messageId,
      statusCode,
    });

    return { success: true, to, messageId };
  } catch (error: any) {
    const rawBody =
      error?.body ?? error?.response?.body ?? error?.response?.data;
    const errorMessage: string =
      rawBody?.message ??
      rawBody?.code ??
      (typeof rawBody === "string" ? rawBody : null) ??
      error?.message ??
      "Unknown Brevo error";

    logger.error(`sendTransactionalEmail: FAILED [${templateKey}] → ${to}`, {
      error: errorMessage,
      statusCode: error?.statusCode ?? error?.response?.statusCode,
      body: rawBody,
    });

    return { success: false, to, error: errorMessage };
  }
}
