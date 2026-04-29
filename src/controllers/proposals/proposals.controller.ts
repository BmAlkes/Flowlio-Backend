import { Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { eq, desc, and } from "drizzle-orm";
import { proposals, notifications, clients } from "@/schema/schema";
import crypto from "crypto";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import fs from "fs";

/**
 * Save a generated proposal to the database and notify the client
 */
export const createProposal = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const organizationId = (req.user as any)?.organizationId;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization not found" });
      return;
    }

    const { clientId, projectTitle, clientName, companyName, proposalData } = req.body;

    if (!clientId || !projectTitle || !proposalData) {
      res.status(400).json({
        success: false,
        message: "clientId, projectTitle, and proposalData are required",
      });
      return;
    }

    // Verify client belongs to this organization
    const [client] = await database
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // Insert proposal
    const [newProposal] = await database
      .insert(proposals)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        clientId,
        createdBy: req.user.id,
        projectTitle,
        clientName: clientName || client.name,
        companyName: companyName || "",
        proposalData,
        status: "pending",
      })
      .returning();

    // Send a notification to the client (if they have a userId linked)
    if (client.userId) {
      try {
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: client.userId,
          organizationId,
          type: "proposal",
          title: "New Proposal Received",
          message: `You have received a new proposal: "${projectTitle}". Please review and approve or reject it in your portal.`,
          data: { proposalId: newProposal.id, projectTitle },
          read: false,
          createdAt: new Date(),
        });
        logger.info(`Notification sent to client user ${client.userId} for proposal ${newProposal.id}`);
      } catch (notifError) {
        // Non-fatal: log but don't fail the proposal creation
        logger.warn("Failed to send client notification:", notifError);
      }
    }

    res.status(201).json({
      success: true,
      message: "Proposal saved and client notified successfully",
      data: newProposal,
    });
  } catch (error) {
    logger.error("Error creating proposal:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save proposal",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Upload a manual proposal file and notify the client
 */
export const uploadManualProposal = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const organizationId = (req.user as any)?.organizationId;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization not found" });
      return;
    }

    const { clientId, projectTitle, clientName, companyName } = req.body;
    const file = req.file;

    if (!clientId || !projectTitle || !file) {
      res.status(400).json({
        success: false,
        message: "clientId, projectTitle, and file are required",
      });
      return;
    }

    // Verify client belongs to this organization
    const [client] = await database
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (!client) {
      res.status(404).json({ success: false, message: "Client not found" });
      return;
    }

    // Upload file to Cloudinary
    let uploadResult;
    try {
      uploadResult = await uploadToCloudinary(file.path, `proposals/${organizationId}`);
      
      // Clean up the local file after upload
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (uploadError) {
      logger.error("Cloudinary upload error:", uploadError);
      res.status(500).json({ success: false, message: "Failed to upload file to storage" });
      return;
    }

    // Insert proposal
    const [newProposal] = await database
      .insert(proposals)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        clientId,
        createdBy: req.user.id,
        projectTitle,
        clientName: clientName || client.name,
        companyName: companyName || "",
        proposalData: {
          isManual: true,
          fileUrl: uploadResult.secure_url,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
        },
        status: "pending",
      })
      .returning();

    // Send a notification to the client (if they have a userId linked)
    if (client.userId) {
      try {
        await database.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: client.userId,
          organizationId,
          type: "proposal",
          title: "New Proposal Received",
          message: `You have received a new proposal: "${projectTitle}". Please review and approve or reject it in your portal.`,
          data: { proposalId: newProposal.id, projectTitle },
          read: false,
          createdAt: new Date(),
        });
      } catch (notifError) {
        logger.warn("Failed to send client notification:", notifError);
      }
    }

    res.status(201).json({
      success: true,
      message: "Proposal uploaded and client notified successfully",
      data: newProposal,
    });
  } catch (error) {
    logger.error("Error uploading manual proposal:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload proposal",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};

/**
 * Get all proposals for the organization (org owner / managers)
 */
export const getOrganizationProposals = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const organizationId = (req.user as any)?.organizationId;
    if (!organizationId) {
      res.status(400).json({ success: false, message: "Organization not found" });
      return;
    }

    const orgProposals = await database
      .select()
      .from(proposals)
      .where(eq(proposals.organizationId, organizationId))
      .orderBy(desc(proposals.createdAt));

    res.status(200).json({
      success: true,
      message: "Proposals retrieved successfully",
      data: orgProposals,
    });
  } catch (error) {
    logger.error("Error fetching organization proposals:", error);
    res.status(500).json({ success: false, message: "Failed to fetch proposals" });
  }
};

/**
 * Get proposals for the logged-in client
 */
export const getClientProposals = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    // Find the client record linked to this user
    const [client] = await database
      .select()
      .from(clients)
      .where(eq(clients.userId, req.user.id))
      .limit(1);

    if (!client) {
      res.status(404).json({ success: false, message: "Client record not found" });
      return;
    }

    const clientProposals = await database
      .select()
      .from(proposals)
      .where(eq(proposals.clientId, client.id))
      .orderBy(desc(proposals.createdAt));

    res.status(200).json({
      success: true,
      message: "Client proposals retrieved successfully",
      data: clientProposals,
    });
  } catch (error) {
    logger.error("Error fetching client proposals:", error);
    res.status(500).json({ success: false, message: "Failed to fetch proposals" });
  }
};

/**
 * Client approves a proposal
 */
export const approveProposal = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const { id } = req.params;

    // Find the client linked to this user
    const [client] = await database
      .select()
      .from(clients)
      .where(eq(clients.userId, req.user.id))
      .limit(1);

    if (!client) {
      res.status(404).json({ success: false, message: "Client record not found" });
      return;
    }

    // Verify proposal belongs to this client
    const [proposal] = await database
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.clientId, client.id)))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ success: false, message: "Proposal not found" });
      return;
    }

    if (proposal.status !== "pending") {
      res.status(400).json({
        success: false,
        message: `Proposal is already ${proposal.status}`,
      });
      return;
    }

    const [updated] = await database
      .update(proposals)
      .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(proposals.id, id))
      .returning();

    // Notify the org owner / creator
    try {
      await database.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: proposal.createdBy,
        organizationId: proposal.organizationId,
        type: "proposal",
        title: "Proposal Approved",
        message: `"${proposal.projectTitle}" has been approved by ${proposal.clientName}.`,
        data: { proposalId: proposal.id, status: "approved" },
        read: false,
        createdAt: new Date(),
      });
    } catch (notifError) {
      logger.warn("Failed to send approval notification:", notifError);
    }

    res.status(200).json({
      success: true,
      message: "Proposal approved successfully",
      data: updated,
    });
  } catch (error) {
    logger.error("Error approving proposal:", error);
    res.status(500).json({ success: false, message: "Failed to approve proposal" });
  }
};

/**
 * Client rejects a proposal
 */
export const rejectProposal = async (
  req: any,
  res: Response
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const { id } = req.params;
    const { reason } = req.body;

    const [client] = await database
      .select()
      .from(clients)
      .where(eq(clients.userId, req.user.id))
      .limit(1);

    if (!client) {
      res.status(404).json({ success: false, message: "Client record not found" });
      return;
    }

    const [proposal] = await database
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.clientId, client.id)))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ success: false, message: "Proposal not found" });
      return;
    }

    if (proposal.status !== "pending") {
      res.status(400).json({ success: false, message: `Proposal is already ${proposal.status}` });
      return;
    }

    const [updated] = await database
      .update(proposals)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: reason || null,
        updatedAt: new Date(),
      })
      .where(eq(proposals.id, id))
      .returning();

    // Notify the creator
    try {
      await database.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: proposal.createdBy,
        organizationId: proposal.organizationId,
        type: "proposal",
        title: "Proposal Rejected",
        message: `"${proposal.projectTitle}" was rejected by ${proposal.clientName}.${reason ? ` Reason: ${reason}` : ""}`,
        data: { proposalId: proposal.id, status: "rejected" },
        read: false,
        createdAt: new Date(),
      });
    } catch (notifError) {
      logger.warn("Failed to send rejection notification:", notifError);
    }

    res.status(200).json({
      success: true,
      message: "Proposal rejected",
      data: updated,
    });
  } catch (error) {
    logger.error("Error rejecting proposal:", error);
    res.status(500).json({ success: false, message: "Failed to reject proposal" });
  }
};
