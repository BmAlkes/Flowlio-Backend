import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Actor } from "../../security/resource-policy";
import { sendTransactionalEmail } from "../../services/email/transactional.service";
import { logger } from "../../utils/logger.util";
import type { Conversation } from "./access";

type Event = {
  conversation: Conversation; actor: Actor; messageId: string; body: string;
  visibility: "internal" | "client"; mentions: string[]; fromClient: boolean; audience: string[];
};

async function notify(pool: Pool, organizationId: string, userIds: string[], title: string, message: string, data: Record<string, unknown>) {
  for (const userId of [...new Set(userIds)]) {
    await pool.query(
      `insert into notifications (id, user_id, organization_id, type, title, message, data, read, created_at) values ($1,$2,$3,'system',$4,$5,$6,false,now())`,
      [randomUUID(), userId, organizationId, title.slice(0, 200), message.slice(0, 500), JSON.stringify(data)]);
  }
}

/**
 * After a message: mentioned people get a notification; a team message to the client is e-mailed
 * to the client; a client message notifies the team that follows the conversation.
 */
export async function notifyAfterMessage(pool: Pool, event: Event) {
  const { conversation, actor } = event;
  const organizationId = conversation.organizationId;
  const author = (await pool.query<{ name: string }>("select name from users where id=$1", [actor.id])).rows[0]?.name ?? "";
  const preview = event.body.length > 200 ? event.body.slice(0, 197) + "…" : event.body;
  const data = { conversationId: conversation.id, messageId: event.messageId, projectId: conversation.projectId, taskId: conversation.taskId };
  try {
    const mentioned = event.mentions.filter(userId => userId !== actor.id && event.audience.includes(userId));
    if (mentioned.length) await notify(pool, organizationId, mentioned, `${author} mencionou você`, preview, data);

    if (event.fromClient) {
      const team = event.audience.filter(userId => userId !== actor.id);
      await notify(pool, organizationId, team, `Nova mensagem de ${author}`, preview, data);
      return;
    }
    if (event.visibility !== "client") return;
    const clientId = conversation.clientId ?? (await pool.query<{ client_id: string | null }>("select client_id from projects where id=$1", [conversation.projectId])).rows[0]?.client_id;
    if (!clientId) return;
    const client = (await pool.query<{ name: string; email: string | null; user_id: string | null }>("select name, email, user_id from clients where id=$1", [clientId])).rows[0];
    if (!client) return;
    if (client.user_id) await notify(pool, organizationId, [client.user_id], `Nova mensagem de ${author}`, preview, data);
    if (client.email) {
      const organization = (await pool.query<{ name: string }>("select name from organizations where id=$1", [organizationId])).rows[0]?.name ?? "";
      const subject = conversation.kind === "task"
        ? (await pool.query<{ title: string }>("select title from tasks where id=$1", [conversation.taskId])).rows[0]?.title ?? organization
        : conversation.kind === "project" ? (await pool.query<{ name: string }>("select name from projects where id=$1", [conversation.projectId])).rows[0]?.name ?? organization
        : organization;
      await sendTransactionalEmail({ to: client.email, toName: client.name, templateKey: "client_message", data: { subject, message: event.body, from: `${author} · ${organization}`, clientName: client.name } });
    }
  } catch (error) {
    logger.warn("Conversation notifications failed", { error: (error as Error)?.message });
  }
}
