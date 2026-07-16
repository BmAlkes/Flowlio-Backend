import { brevoTransactionApi } from "@/configs/brevo.config";
import {
  taskOverdueTemplate,
  projectRiskTemplate,
  leadFollowUpTemplate,
  weeklySummaryTemplate,
  invoiceOverdueTemplate,
  paymentLinkReminderTemplate,
  webhookIssueTemplate,
  newLeadNotContactedTemplate,
  clientInactivityTemplate,
  supportTicketUnansweredTemplate,
  trialEndingTemplate,
  planUsageLimitTemplate,
  type InvoiceOverdueEmailData,
  type PaymentLinkReminderEmailData,
  type WebhookIssueEmailData,
  type NewLeadNotContactedEmailData,
  type ClientInactivityEmailData,
  type SupportTicketUnansweredEmailData,
  type TrialEndingEmailData,
  type PlanUsageLimitEmailData,
} from "@/utils/brevo.util";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";

export type TransactionalTemplateKey =
  | "task_overdue"
  | "project_risk"
  | "lead_follow_up"
  | "weekly_summary"
  | "invoice_overdue"
  | "payment_link_reminder"
  | "webhook_issue"
  | "new_lead_not_contacted"
  | "client_inactivity"
  | "support_ticket_unanswered"
  | "trial_ending"
  | "plan_usage_limit";

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
  invoice_overdue: InvoiceOverdueEmailData;
  payment_link_reminder: PaymentLinkReminderEmailData;
  webhook_issue: WebhookIssueEmailData;
  new_lead_not_contacted: NewLeadNotContactedEmailData;
  client_inactivity: ClientInactivityEmailData;
  support_ticket_unanswered: SupportTicketUnansweredEmailData;
  trial_ending: TrialEndingEmailData;
  plan_usage_limit: PlanUsageLimitEmailData;
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
    case "invoice_overdue":
      return invoiceOverdueTemplate(data as InvoiceOverdueEmailData);
    case "payment_link_reminder":
      return paymentLinkReminderTemplate(data as PaymentLinkReminderEmailData);
    case "webhook_issue":
      return webhookIssueTemplate(data as WebhookIssueEmailData);
    case "new_lead_not_contacted":
      return newLeadNotContactedTemplate(data as NewLeadNotContactedEmailData);
    case "client_inactivity":
      return clientInactivityTemplate(data as ClientInactivityEmailData);
    case "support_ticket_unanswered":
      return supportTicketUnansweredTemplate(data as SupportTicketUnansweredEmailData);
    case "trial_ending":
      return trialEndingTemplate(data as TrialEndingEmailData);
    case "plan_usage_limit":
      return planUsageLimitTemplate(data as PlanUsageLimitEmailData);
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
    case "invoice_overdue":
      return `[Flowlio] Invoice overdue: ${data.invoiceNumber} — ${data.clientname}`;
    case "payment_link_reminder":
      return `[Flowlio] Payment link reminder: ${data.clientname}`;
    case "webhook_issue":
      return `[Flowlio] Webhook issue detected: ${data.webhookName}`;
    case "new_lead_not_contacted":
      return `[Flowlio] New lead not contacted: ${data.leadName}`;
    case "client_inactivity":
      return `[Flowlio] Client inactivity: ${data.clientName}`;
    case "support_ticket_unanswered":
      return `[Flowlio] Support ticket unanswered: #${data.ticketNumber}`;
    case "trial_ending":
      return `[Flowlio] Your trial ends in ${data.daysLeft} day${data.daysLeft === 1 ? "" : "s"}`;
    case "plan_usage_limit":
      return `[Flowlio] Plan usage alert: ${data.resourceName} at ${data.usagePercent}%`;
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
