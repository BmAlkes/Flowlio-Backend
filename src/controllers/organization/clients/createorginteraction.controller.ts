import { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { requireOrganizationId } from "@/utils/organization.util";
import { sendEmail } from "@/configs/brevo.config";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";

export const createOrgInteraction = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const user = (req as any).user;
    if (!user) {
      res.status(status.UNAUTHORIZED).json({ success: false, message: "Not authenticated" });
      return;
    }

    const { clientId, content } = req.body;

    if (!clientId || typeof clientId !== "string" || clientId.trim() === "") {
      res.status(status.BAD_REQUEST).json({ success: false, message: "clientId is required" });
      return;
    }
    if (!content || typeof content !== "string" || content.trim() === "") {
      res.status(status.BAD_REQUEST).json({ success: false, message: "content is required" });
      return;
    }

    // Verify client exists and belongs to this org
    const clientCheck = await connection.query<{ id: string; name: string; email: string }>({
      text: `SELECT id, name, email FROM clients WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      values: [clientId.trim(), organizationId],
    });

    if (clientCheck.rows.length === 0) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Client not found" });
      return;
    }

    const { name: clientName, email: clientEmail } = clientCheck.rows[0];
    const id = randomUUID();
    const now = new Date().toISOString();

    await connection.query({
      text: `
        INSERT INTO client_interactions (id, client_id, user_id, organization_id, type, content, created_at)
        VALUES ($1, $2, $3, $4, 'note', $5, $6)
      `,
      values: [id, clientId.trim(), user.id, organizationId, content.trim(), now],
    });

    res.status(status.CREATED).json({
      success: true,
      data: {
        id,
        clientId: clientId.trim(),
        clientName,
        content: content.trim(),
        type: "note",
        createdAt: now,
        userId: user.id,
        userName: user.name,
        replies: [],
      },
    });

    // Notify client by email (fire-and-forget)
    sendNewMessageEmail({ clientName, clientEmail, userName: user.name, content: content.trim() })
      .catch((err) => logger.error("Failed to send new message email to client:", err));
  } catch (error: any) {
    logger.error("Error creating org interaction:", {
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

async function sendNewMessageEmail(params: {
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
        <p style="font-size: 16px; color: #333;">Hi <b>${clientName}</b>,</p>
        <p style="font-size: 16px; color: #333;"><b>${userName}</b> sent you a message:</p>
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
