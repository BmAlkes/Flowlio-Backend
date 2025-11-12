import { Response } from "express";
import { paymentLinks } from "@/schema/schema";
import { database } from "../../../configs/connection.config";
import { createPaymentLinkSchema } from "@/schema/validation";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import { randomUUID } from "crypto";
import { z } from "zod";
import { env } from "@/utils/env.util";

interface CreatePaymentLinkRequest {
  body: z.infer<typeof createPaymentLinkSchema>;
  user?: {
    id: string;
    email: string;
    role: string;
    organizationId?: string;
  };
}

export const createPaymentLink = async (
  req: CreatePaymentLinkRequest,
  res: Response
): Promise<void> => {
  try {
    // Validate request body
    const validatedData = createPaymentLinkSchema.parse(req.body);

    // Check if user is authenticated
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
      return;
    }

    // Check if organization ID is provided
    if (!req.user.organizationId) {
      res.status(400).json({
        success: false,
        message: "User must belong to an organization",
      });
      return;
    }

    // Get client and project information
    const organizationId = req.user!.organizationId as string;

    const client = await database.query.clients.findFirst({
      where: (clients, { eq, and }) =>
        and(
          eq(clients.id, validatedData.clientId),
          eq(clients.organizationId, organizationId)
        ),
    });

    if (!client) {
      res.status(404).json({
        success: false,
        message: "Client not found",
      });
      return;
    }

    const project = await database.query.projects.findFirst({
      where: (projects, { eq, and }) =>
        and(
          eq(projects.id, validatedData.projectId),
          eq(projects.organizationId, organizationId)
        ),
    });

    if (!project) {
      res.status(404).json({
        success: false,
        message: "Project not found",
      });
      return;
    }

    // Generate unique payment link
    const paymentLinkId = randomUUID();
    const frontendUrl = env.FRONTEND_DOMAIN || "http://localhost:4000";
    const paymentLink = `${frontendUrl}/payment/${paymentLinkId}`;

    // Create payment link
    const paymentLinkData = {
      id: paymentLinkId,
      organizationId: organizationId,
      clientId: validatedData.clientId,
      projectId: validatedData.projectId,
      createdBy: req.user!.id,
      description: validatedData.description,
      project: project.name,
      submittedby: req.user!.email,
      clientname: client.name,
      amount: validatedData.amount.toString(),
      paymentLink: paymentLink,
    };

    const [newPaymentLink] = await database
      .insert(paymentLinks)
      .values(paymentLinkData)
      .returning();

    logger.info("Payment link created successfully:", {
      paymentLinkId: newPaymentLink.id,
      userId: req.user!.id,
      organizationId: organizationId,
      clientId: validatedData.clientId,
      projectId: validatedData.projectId,
    });

    res.status(201).json({
      success: true,
      message: "Payment link created successfully",
      data: newPaymentLink,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn("Validation error in create payment link:", error.errors);
      res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: error.errors,
      });
      return;
    }

    logger.error("Error creating payment link:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Failed to create payment link",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
