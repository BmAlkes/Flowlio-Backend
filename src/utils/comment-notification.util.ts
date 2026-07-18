import { database } from "@/configs/connection.config";
import { users, notifications, userOrganizations } from "@/schema/schema";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger.util";
import crypto from "crypto";

export const notifyProjectComment = async (params: {
  commentId: string;
  projectId: string;
  projectName: string;
  content: string;
  parentId: string | null;
  actor: { id: string; name: string };
  organizationId: string;
}) => {
  const { commentId, projectId, projectName, content, parentId, actor, organizationId } = params;

  try {
    const allMembers = await database.query.userOrganizations.findMany({
      where: eq(userOrganizations.organizationId, organizationId),
    });

    const usersToNotify = new Set(allMembers.map((m) => m.userId));
    usersToNotify.delete(actor.id);

    if (usersToNotify.size === 0) return;

    const targetUsers = await database.query.users.findMany({
      where: inArray(users.id, Array.from(usersToNotify)),
      columns: { id: true },
    });

    const isReply = !!parentId;
    const title = isReply
      ? `New reply in ${projectName}`
      : `New comment in ${projectName}`;
    const preview = content.substring(0, 100) + (content.length > 100 ? "..." : "");
    const message = `${actor.name}: ${preview}`;

    await Promise.allSettled(
      targetUsers.map((user) =>
        database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: user.id,
          organizationId,
          type: "project_comment",
          title,
          message,
          data: { projectId, commentId, isReply },
          read: false,
          createdAt: new Date(),
        })
      )
    );
  } catch (error) {
    logger.error("Error in notifyProjectComment:", error);
  }
};

export const notifyCommentMentions = async (params: {
  commentId: string;
  projectId: string;
  taskId?: string | null;
  mentions: string[];
  actor: { id: string; name: string };
  organizationId: string;
}) => {
  const { commentId, projectId, taskId, mentions, actor, organizationId } = params;

  if (!mentions || mentions.length === 0) return;

  try {
    const uniqueMentions = [...new Set(mentions)].filter((id) => id !== actor.id);
    if (uniqueMentions.length === 0) return;

    await Promise.allSettled(
      uniqueMentions.map((userId) =>
        database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId,
          organizationId,
          type: "comment_mention",
          title: `${actor.name} mentioned you in a comment`,
          message: `You were mentioned in a comment`,
          data: { projectId, taskId: taskId ?? null, commentId },
          read: false,
          createdAt: new Date(),
        })
      )
    );
  } catch (error) {
    logger.error("Error in notifyCommentMentions:", error);
  }
};
