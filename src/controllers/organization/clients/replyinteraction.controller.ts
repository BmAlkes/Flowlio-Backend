import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { sendEmail } from "@/configs/brevo.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";

export const replyToInteraction = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Not authenticated" });
      return;
    }

    const { interactionId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== "string" || content.trim() === "") {
      res.status(status.BAD_REQUEST).json({ success: false, message: "content is required" });
      return;
    }

    // Verify interaction exists and belongs to this org
    const interactionCheck = await connection.query<{
      id: string;
      clientId: string;
      clientName: string;
      clientEmail: string;
    }>({
      text: `
        SELECT ci.id, ci.client_id AS "clientId", c.name AS "clientName", c.email AS "clientEmail"
        FROM client_interactions ci
        JOIN clients c ON c.id = ci.client_id
        WHERE ci.id = $1 AND ci.organization_id = $2
        LIMIT 1
      `,
      values: [interactionId, organizationId],
    });

    if (interactionCheck.rows.length === 0) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Interaction not found" });
      return;
    }

    const { clientName, clientEmail } = interactionCheck.rows[0];
    const id = randomUUID();
    const now = new Date().toISOString();

    const result = await connection.query<{
      id: string;
      interactionId: string;
      content: string;
      userId: string;
      createdAt: string;
    }>({
      text: `
        INSERT INTO interaction_replies (id, interaction_id, user_id, content, created_at)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          interaction_id AS "interactionId",
          content,
          user_id        AS "userId",
          created_at     AS "createdAt"
      `,
      values: [id, interactionId, user.id, content.trim(), now],
    });

    if (result.rows.length === 0) {
      res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Failed to create reply" });
      return;
    }

    res.status(status.CREATED).json({
      success: true,
      data: {
        ...result.rows[0],
        userName: user.name,
      },
    });

    // Notify client by email (fire-and-forget)
    sendClientReplyEmail({ clientName, clientEmail, userName: user.name, content: content.trim() })
      .catch((err) => logger.error("Failed to send reply email to client:", err));
  } catch (error: any) {
    logger.error("Error creating interaction reply:", {
      message: error?.message,
      cause: error?.cause,
      detail: error?.detail,
    });
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.cause?.message ?? error?.message ?? "Internal server error",
    });
  }
};

async function sendClientReplyEmail(params: {
  clientName: string;
  clientEmail: string;
  userName: string;
  content: string;
}) {
  const { clientName, clientEmail, userName, content } = params;

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; background: #f7f9fb; padding: 32px;">
      <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 12px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 32px;">
        <h2 style="margin: 0 0 24px; color: #1a202c;">You have a new message</h2>
        <p style="font-size: 16px; color: #333;">
          Hi <b>${clientName}</b>,
        </p>
        <p style="font-size: 16px; color: #333;">
          <b>${userName}</b> sent you a message:
        </p>
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;
                    margin: 20px 0; border-left: 4px solid #2563eb;">
          <p style="margin: 0; font-size: 15px; color: #555; white-space: pre-wrap;">${content}</p>
        </div>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
        <p style="font-size: 12px; color: #bbb; text-align: center;">
          &copy; ${new Date().getFullYear()} Flowlio. All rights reserved.
        </p>
      </div>
    </div>
  `;

  await sendEmail({
    subject: `New message from ${userName}`,
    htmlContent,
    sender: { email: "noreply@flowlio.com", name: "Flowlio" },
    to: [{ email: clientEmail, name: clientName }],
  });
}
