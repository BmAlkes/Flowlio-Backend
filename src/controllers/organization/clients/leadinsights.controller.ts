import { Request, Response } from "express";
import { calculateLeadInsight } from "../../../services/leadScoring.service";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { requireOrganizationId } from "@/utils/organization.util";

export const getLeadInsights = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = requireOrganizationId(req as any, res);
    if (!organizationId) return;

    const { id: clientId } = req.params;

    const insights = await calculateLeadInsight(clientId);

    res.status(status.OK).json({
      success: true,
      data: insights
    });

  } catch (error) {
    logger.error("Error fetching lead insights:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error"
    });
  }
};
