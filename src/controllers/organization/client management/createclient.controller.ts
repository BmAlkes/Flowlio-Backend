import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { users, clients, organizations, account } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logActivity } from "@/utils/activity.util";
import { requireOrganizationId } from "@/utils/organization.util";
import { logger } from "@/utils/logger.util";
import { canCreateClient } from "@/utils/plan-access.util";

export const createClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userReq = req as any;
    // Check if user is authenticated
    if (!userReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
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
        userId: userReq.user?.id,
      });
      res.status(404).json({
        success: false,
        error: "Organization not found",
        message:
          "The organization associated with your account does not exist. Please contact support.",
        code: "ORGANIZATION_NOT_FOUND",
      });
      return;
    }

    const clientAccess = await canCreateClient(organizationId);
    if (!clientAccess.hasAccess) {
      res.status(403).json({ success: false, message: clientAccess.reason });
      return;
    }

    // Extract client data from request body
    const {
      name,
      email,
      password, // New field for authentication
      phone,
      cpfcnpj,
      businessIndustry,
      address,
      socialMediaLinks,
      status = "New Lead",
      image,
      customFields,
    } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      res.status(400).json({
        error: "Name, email, and password are required fields",
      });
      return;
    }

    // Check if client with same email already exists in users table (auth identity)
    const existingUser = await database
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      res.status(409).json({
        error: "A user with this email already exists",
      });
      return;
    }

    let imageUrl = null;
    let imagePublicId = null;

    // Handle image upload if provided
    if (image && typeof image === "string" && image.startsWith("data:image")) {
      try {
        const uploadResult = await uploadToCloudinary(image, "clients");
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        res.status(500).json({
          error: "Failed to upload client image",
        });
        return;
      }
    }

    // Parse social media links and custom fields
    const parsedSocialMediaLinks =
      typeof socialMediaLinks === "string"
        ? JSON.parse(socialMediaLinks)
        : socialMediaLinks || null;
    const parsedCustomFields =
      typeof customFields === "string"
        ? JSON.parse(customFields)
        : customFields || null;

    // Use Better Auth's password hashing
    const { auth } = await import("@/lib/auth");
    const authContext = await auth.$context;
    const hashedPassword = await authContext.password.hash(password);

    // Transactional creation flow
    const result = await database.transaction(async (tx) => {
      const userId = randomUUID().replace(/-/g, "");
      const clientId = randomUUID();
      const now = new Date();

      // Step 1: Create user record
      const [newUser] = await tx
        .insert(users)
        .values({
          id: userId,
          name,
          email,
          role: "client",
          status: "active",
          image: imageUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // Step 2: Create account record
      await tx.insert(account).values({
        id: randomUUID().replace(/-/g, ""),
        accountId: userId,
        providerId: "credential",
        userId: userId,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      });

      // Step 3: Create client record
      const [newClient] = await tx
        .insert(clients)
        .values({
          id: clientId,
          userId,
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
          customFields: parsedCustomFields,
          status,
          clientType: "client",
          createdBy: userReq.user!.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return { newUser, newClient, clientId };
    });

    // Log activity
    await logActivity({
      organizationId,
      actorId: userReq.user.id,
      type: "client",
      action: "create",
      resource: "client",
      resourceId: result.clientId,
      message: `Created client: ${result.newClient.name}`,
      metadata: { email, status },
    });

    // Return success response
    res.status(201).json({
      success: true,
      message: "Client created successfully with authentication access",
      data: {
        id: result.newClient.id,
        userId: result.newClient.userId,
        name: result.newClient.name,
        email: result.newClient.email,
        image: result.newClient.image,
        status: result.newClient.status,
        createdAt: result.newClient.createdAt,
      },
    });
  } catch (error) {
    logger.error("Error creating client:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error while creating client",
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
};
