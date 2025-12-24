import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, organizations } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logActivity } from "@/utils/activity.util";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";

export const createClient = async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get organization ID from authenticated user
    const organizationId = requireOrganizationId(req, res);
    if (!organizationId) {
      return; // Response already sent by requireOrganizationId
    }

    // Verify that the organization exists in the database
    const organization = await database
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (organization.length === 0) {
      logger.error("Organization not found in database", {
        organizationId,
        userId: req.user?.id,
      });
      return res.status(404).json({
        success: false,
        error: "Organization not found",
        message:
          "The organization associated with your account does not exist. Please contact support.",
        code: "ORGANIZATION_NOT_FOUND",
      });
    }

    // Extract client data from request body
    const {
      name,
      email,
      phone,
      cpfcnpj,
      businessIndustry,
      address,
      socialMediaLinks,
      status = "New Lead",
      image,
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        error: "Name and email are required fields",
      });
    }

    // Check if client with same email already exists in this organization
    const existingClient = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.email, email),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existingClient.length > 0) {
      return res.status(409).json({
        error: "Client with this email already exists in your organization",
      });
    }

    let imageUrl = null;
    let imagePublicId = null;

    // Handle image upload if provided
    if (image && typeof image === "string" && image.startsWith("data:image")) {
      try {
        // For base64 data, we can upload directly
        const uploadResult = await uploadToCloudinary(image, "clients");
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        return res.status(500).json({
          error: "Failed to upload client image",
        });
      }
    }

    // Parse social media links if provided
    let parsedSocialMediaLinks = null;
    if (socialMediaLinks) {
      try {
        parsedSocialMediaLinks =
          typeof socialMediaLinks === "string"
            ? JSON.parse(socialMediaLinks)
            : socialMediaLinks;
      } catch (error) {
        console.error("Error parsing social media links:", error);
        parsedSocialMediaLinks = null;
      }
    }

    // Create client
    const newClient = await database
      .insert(clients)
      .values({
        id: randomUUID(),
        organizationId,
        name,
        email,
        image: imageUrl,
        imagePublicId,
        phone,
        cpfcnpj,
        businessIndustry,
        address,
        socialMediaLinks: parsedSocialMediaLinks,
        status,
        createdBy: req.user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Log activity
    const userId = req.user?.id;
    if (organizationId && userId) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "client",
        action: "create",
        resource: "client",
        resourceId: newClient[0].id,
        message: `Created client: ${name}`,
        metadata: { email, status },
      });
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: "Client created successfully",
      data: {
        id: newClient[0].id,
        name: newClient[0].name,
        email: newClient[0].email,
        image: newClient[0].image,
        phone: newClient[0].phone,
        cpfcnpj: newClient[0].cpfcnpj,
        businessIndustry: newClient[0].businessIndustry,
        address: newClient[0].address,
        status: newClient[0].status,
        createdAt: newClient[0].createdAt,
      },
    });
  } catch (error) {
    logger.error("Error creating client:", error);
    
    // Check if it's a foreign key constraint violation
    if (error instanceof Error && error.message.includes("foreign key constraint")) {
      return res.status(400).json({
        success: false,
        error: "Invalid organization",
        message:
          "The organization associated with your account is invalid. Please contact support or try logging out and logging back in.",
        code: "ORGANIZATION_INVALID",
      });
    }

    res.status(500).json({
      success: false,
      error: "Internal server error while creating client",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
};
