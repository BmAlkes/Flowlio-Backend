import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { proposals, clients } from "@/schema/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "@/utils/logger.util";
import status from "http-status";

/**
 * GET /api/proposals/client/:clientId
 * Returns all proposals for a specific client, scoped to the org of the authenticated user.
 */
export const getProposalsByClient = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { clientId } = req.params;
    const organizationId = req.user?.organizationId;

    if (!clientId) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "clientId is required",
      });
      return;
    }

    if (!organizationId) {
      res.status(status.UNAUTHORIZED).json({
        success: false,
        message: "Organization context is required",
      });
      return;
    }

    // Verify client belongs to this org
    const [clientData] = await database
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (!clientData) {
      res.status(status.FORBIDDEN).json({
        success: false,
        message: "Client not found or does not belong to this organization",
      });
      return;
    }

    const rows = await database
      .select({
        id: proposals.id,
        projectTitle: proposals.projectTitle,
        status: proposals.status,
        proposalData: proposals.proposalData,
        approvedAt: proposals.approvedAt,
        rejectedAt: proposals.rejectedAt,
        createdAt: proposals.createdAt,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .where(and(eq(proposals.clientId, clientId), eq(proposals.organizationId, organizationId)))
      .orderBy(desc(proposals.createdAt));

    const mapped = rows.map((p) => {
      const data = p.proposalData as any;
      return {
        id: p.id,
        title: p.projectTitle,
        status: p.status,
        totalValue: data?.totalValue ?? data?.total ?? null,
        sentAt: null,
        respondedAt: p.approvedAt ?? p.rejectedAt ?? null,
        pdfUrl: data?.fileUrl ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    logger.info(`Fetched ${mapped.length} proposals for client ${clientId}`);

    res.status(status.OK).json({
      success: true,
      data: {
        clientId,
        clientName: clientData.name,
        proposalCount: mapped.length,
        proposals: mapped,
      },
    });
  } catch (error) {
    logger.error("Error fetching proposals by client:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
