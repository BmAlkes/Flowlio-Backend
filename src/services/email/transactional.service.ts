import { brevoTransactionApi } from "@/configs/brevo.config";
import { taskOverdueTemplate } from "@/utils/brevo.util";
import { logger } from "@/utils/logger.util";
import { env } from "@/utils/env.util";

type TransactionalTemplateKey = "task_overdue";

interface TaskOverdueData {
  assigneeName: string;
  taskTitle: string;
  projectName: string;
  endDate: string;
  taskUrl?: string;
}

type TemplateDataMap = {
  task_overdue: TaskOverdueData;
};

function buildHtml<K extends TransactionalTemplateKey>(
  templateKey: K,
  data: TemplateDataMap[K],
): string {
  switch (templateKey) {
    case "task_overdue":
      return taskOverdueTemplate(data as TaskOverdueData);
    default:
      throw new Error(`Unknown email template: ${templateKey}`);
  }
}

function buildSubject(templateKey: TransactionalTemplateKey, data: any): string {
  switch (templateKey) {
    case "task_overdue":
      return `[Flowlio] Task overdue: ${data.taskTitle}`;
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
}): Promise<void> {
  if (!env.BREVO_SENDER) {
    logger.error("sendTransactionalEmail: BREVO_SENDER not configured");
    return;
  }

  const htmlContent = buildHtml(templateKey, data);
  const subject = buildSubject(templateKey, data);

  try {
    await brevoTransactionApi.sendTransacEmail({
      to: [{ email: to, name: toName ?? to }],
      subject,
      htmlContent,
      sender: { name: "Flowlio", email: env.BREVO_SENDER },
    });
    logger.info(`Transactional email sent [${templateKey}] → ${to}`);
  } catch (error: any) {
    logger.error(`Failed to send transactional email [${templateKey}] → ${to}:`, {
      message: error?.message,
      body: error?.body ?? error?.response?.body,
    });
  }
}
