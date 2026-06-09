import { Response } from "express";
import { database, connection } from "../../../configs/connection.config";
import { clientInteractions, clients } from "../../../schema/schema";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";
import { notifyClientInteraction } from "@/utils/client-notification.util";

type Reply = {
  id: string;
  content: string;
  createdAt: string;
  userId: string;
  userName: string | null;
};

type TimelineRow = {
  id: string;
  clientId: string;
  userId: string;
  organizationId: string;
  type: string;
  content: string;
  metadata: unknown;
  createdAt: string;
  userName: string | null;
  userImage: string | null;
  replies: Reply[];
};

// Fetch interactions for a client — includes nested replies
export const getClientTimeline = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { id: clientId } = req.params;

    const result = await connection.query<TimelineRow>({
      text: `
        SELECT
          ci.id,
          ci.client_id       AS "clientId",
          ci.user_id         AS "userId",
          ci.organization_id AS "organizationId",
          ci.type,
          ci.content,
          ci.metadata,
          ci.created_at      AS "createdAt",
          u.name             AS "userName",
          u.image            AS "userImage",
          COALESCE(
            json_agg(
              json_build_object(
                'id',        ir.id,
                'content',   ir.content,
                'createdAt', ir.created_at,
                'userId',    ir.user_id,
                'userName',  ru.name
              ) ORDER BY ir.created_at ASC
            ) FILTER (WHERE ir.id IS NOT NULL),
            '[]'::json
          ) AS replies
        FROM client_interactions ci
        LEFT JOIN users u  ON u.id  = ci.user_id
        LEFT JOIN interaction_replies ir ON ir.interaction_id = ci.id
        LEFT JOIN users ru ON ru.id = ir.user_id
        WHERE ci.client_id = $1 AND ci.organization_id = $2
        GROUP BY ci.id, u.name, u.image
        ORDER BY ci.created_at DESC
      `,
      values: [clientId, organizationId],
    });

    const data = result.rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      userId: r.userId,
      organizationId: r.organizationId,
      type: r.type,
      content: r.content,
      metadata: r.metadata ?? null,
      createdAt: r.createdAt,
      user: { name: r.userName ?? null, image: r.userImage ?? null },
      replies: r.replies ?? [],
    }));

    res.status(status.OK).json({ success: true, data });
  } catch (error: any) {
    logger.error("Error fetching client timeline:", {
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

// Add a new interaction (note, call, email, meeting)
export const addClientInteraction = async (req: any, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) return;

    const { clientId, type, content, metadata } = req.body;

    if (!clientId || !type || !content) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "Client ID, type and content are required"
      });
      return;
    }

    const interaction = await database.insert(clientInteractions).values({
      clientId,
      userId: req.user?.id as string,
      organizationId,
      type,
      content,
      metadata
    }).returning();

    // Update last interaction timestamp on client
    await database.update(clients)
      .set({ lastInteractionAt: new Date() })
      .where(eq(clients.id, clientId));

    res.status(status.CREATED).json({
      success: true,
      data: interaction[0]
    });

    // Notify assigned manager and admins (async)
    notifyClientInteraction({
      interaction: interaction[0],
      actor: req.user,
      organizationId
    }).catch(err => logger.error("Background notification failed:", err));

  } catch (error) {
    logger.error("Error adding client interaction:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};
