import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, users } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

export const updateClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userReq = req as any;
    // Check if user is authenticated and has organization ID
    if (!userReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id: clientId } = req.params;

    if (!clientId) {
      res.status(400).json({
        error: "Client ID is required",
      });
      return;
    }

    const organizationId = userReq.user.organizationId;

    if (!organizationId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    // Extract update data
    const {
      name,
      email,
      phone,
      cpfcnpj,
      businessIndustry,
      address,
      socialMediaLinks,
      status,
      image,
      customFields,
    } = req.body;

    // Check if client exists
    const existingClient = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existingClient.length === 0) {
      res.status(404).json({
        error: "Client not found or access denied",
      });
      return;
    }

    const currentClient = existingClient[0];

    // Check email conflicts in users table (auth identity)
    if (email && email !== currentClient.email) {
      const emailConflict = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (emailConflict.length > 0) {
        res.status(409).json({
          error: "Another user with this email already exists",
        });
        return;
      }
    }

    let imageUrl = currentClient.image || null;
    let imagePublicId = currentClient.imagePublicId || null;

    // Handle image if provided
    if (image && typeof image === "string" && image.startsWith("data:image")) {
      try {
        const uploadResult = await uploadToCloudinary(image, "clients");
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Image upload failed:", uploadError);
        res.status(500).json({
          error: "Failed to upload client image",
        });
        return;
      }
    }

    // Parse social media links and custom fields
    const parsedSocialMediaLinks =
      socialMediaLinks !== undefined
        ? typeof socialMediaLinks === "string"
          ? JSON.parse(socialMediaLinks)
          : socialMediaLinks
        : currentClient.socialMediaLinks;

    const parsedCustomFields =
      customFields !== undefined
        ? typeof customFields === "string"
          ? JSON.parse(customFields)
          : customFields
        : currentClient.customFields;

    // Update client and associated user in a transaction
    const result = await database.transaction(async (tx) => {
      // 1. Update user if name or email changed
      if (
        (name && name !== currentClient.name) ||
        (email && email !== currentClient.email)
      ) {
        await tx
          .update(users)
          .set({
            name: name || currentClient.name,
            email: email || currentClient.email,
            updatedAt: new Date(),
          })
          .where(eq(users.id, currentClient.userId as string));
      }

      // 2. Update client
      const [updatedClient] = await tx
        .update(clients)
        .set({
          name: name || currentClient.name,
          email: email || currentClient.email,
          phone: phone !== undefined ? phone : currentClient.phone,
          cpfcnpj: cpfcnpj !== undefined ? cpfcnpj : currentClient.cpfcnpj,
          businessIndustry:
            businessIndustry !== undefined
              ? businessIndustry
              : currentClient.businessIndustry,
          address: address !== undefined ? address : currentClient.address,
          socialMediaLinks: parsedSocialMediaLinks,
          customFields: parsedCustomFields,
          status: status || currentClient.status,
          image: imageUrl,
          imagePublicId,
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId))
        .returning();

      return updatedClient;
    });

    if (!result) {
      res.status(500).json({
        error: "Failed to update client",
      });
      return;
    }

    // Log activity
    await logActivity({
      organizationId,
      actorId: userReq.user.id,
      type: "client",
      action: "update",
      resource: "client",
      resourceId: clientId,
      message: `Updated client: ${result.name}`,
      metadata: { email: result.email, status: result.status },
    });

    res.status(200).json({
      success: true,
      message: "Client updated successfully",
      data: {
        id: result.id,
        name: result.name,
        email: result.email,
        image: result.image,
        phone: result.phone,
        cpfcnpj: result.cpfcnpj,
        businessIndustry: result.businessIndustry,
        address: result.address,
        socialMediaLinks: result.socialMediaLinks,
        status: result.status,
        customFields: result.customFields,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    console.error("Error updating client:", error);
    res.status(500).json({
      error: "Internal server error while updating client",
    });
  }
};
