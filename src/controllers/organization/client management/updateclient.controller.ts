import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { eq, and, ne } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";

export const updateClient = async (req: Request, res: Response) => {
  try {
    // Check if user is authenticated and has organization ID
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id: clientId } = req.params;

    if (!clientId) {
      return res.status(400).json({
        error: "Client ID is required",
      });
    }

    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({ error: "Organization ID is required" });
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
    } = req.body;

    // Check if client exists
    const existingClient = await database
      .select()
      .from(clients)
      .where(
        and(
          eq(clients.id, clientId),
          eq(clients.organizationId, organizationId)
        )
      )
      .limit(1);

    const clientExists = existingClient.length > 0;
    const currentClient = clientExists ? existingClient[0] : null;

    // Check email conflicts (only if email is being changed)
    if (email && (!currentClient || email !== currentClient.email)) {
      const emailConflict = await database
        .select()
        .from(clients)
        .where(
          and(
            eq(clients.email, email),
            eq(clients.organizationId, organizationId),
            ne(clients.id, clientId)
          )
        )
        .limit(1);

      if (emailConflict.length > 0) {
        return res.status(409).json({
          error: "Another client with this email already exists",
        });
      }
    }

    let imageUrl = currentClient?.image || null;
    let imagePublicId = currentClient?.imagePublicId || null;

    // Handle image if provided
    if (image && typeof image === "string" && image.startsWith("data:image")) {
      try {
        const uploadResult = await uploadToCloudinary(image, "clients");
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Image upload failed:", uploadError);
        return res.status(500).json({
          error: "Failed to upload client image",
        });
      }
    }

    // Prepare data for upsert
    const clientData: any = {
      id: clientId,
      organizationId,
      updatedAt: new Date(),
    };

    // Only set fields that are explicitly provided (UPSERT approach)
    if (name !== undefined && name !== null && name !== "") {
      clientData.name = name;
    } else if (clientExists) {
      clientData.name = currentClient?.name; // Keep existing
    }

    if (email !== undefined && email !== null && email !== "") {
      clientData.email = email;
    } else if (clientExists) {
      clientData.email = currentClient?.email; // Keep existing
    }

    if (phone !== undefined && phone !== null) {
      clientData.phone = phone;
    } else if (clientExists) {
      clientData.phone = currentClient?.phone; // Keep existing
    }

    if (cpfcnpj !== undefined && cpfcnpj !== null) {
      clientData.cpfcnpj = cpfcnpj;
    } else if (clientExists) {
      clientData.cpfcnpj = currentClient?.cpfcnpj; // Keep existing
    }

    if (businessIndustry !== undefined && businessIndustry !== null) {
      clientData.businessIndustry = businessIndustry;
    } else if (clientExists) {
      clientData.businessIndustry = currentClient?.businessIndustry; // Keep existing
    }

    if (address !== undefined && address !== null) {
      clientData.address = address;
    } else if (clientExists) {
      clientData.address = currentClient?.address; // Keep existing
    }

    // Parse social media links if provided
    if (socialMediaLinks !== undefined && socialMediaLinks !== null) {
      try {
        clientData.socialMediaLinks =
          typeof socialMediaLinks === "string"
            ? JSON.parse(socialMediaLinks)
            : socialMediaLinks;
      } catch (error) {
        console.error("Error parsing social media links:", error);
        // Keep existing if parse fails
        if (clientExists) {
          clientData.socialMediaLinks = currentClient?.socialMediaLinks;
        }
      }
    } else if (clientExists) {
      clientData.socialMediaLinks = currentClient?.socialMediaLinks; // Keep existing
    }

    if (status !== undefined && status !== null && status !== "") {
      clientData.status = status;
    } else if (clientExists) {
      clientData.status = currentClient?.status; // Keep existing
    } else {
      clientData.status = "New Lead"; // Default for new clients
    }

    if (imageUrl !== currentClient?.image) {
      clientData.image = imageUrl;
      clientData.imagePublicId = imagePublicId;
    } else if (clientExists) {
      clientData.image = currentClient?.image; // Keep existing
      clientData.imagePublicId = currentClient?.imagePublicId; // Keep existing
    }

    // Set createdAt for new clients
    if (!clientExists) {
      clientData.createdAt = new Date();
    }

    let result;
    if (clientExists) {
      // UPDATE existing client
      result = await database
        .update(clients)
        .set(clientData)
        .where(
          and(
            eq(clients.id, clientId),
            eq(clients.organizationId, organizationId)
          )
        )
        .returning();
    } else {
      // INSERT new client
      result = await database.insert(clients).values(clientData).returning();
    }

    if (result.length === 0) {
      return res.status(500).json({
        error: clientExists
          ? "Failed to update client"
          : "Failed to create client",
      });
    }

    const operation = clientExists ? "updated" : "created";

    // Log activity
    const userId = req.user?.id;
    if (organizationId && userId && result[0]) {
      await logActivity({
        organizationId,
        actorId: userId,
        type: "client",
        action: operation === "updated" ? "update" : "create",
        resource: "client",
        resourceId: clientId,
        message: `${
          operation.charAt(0).toUpperCase() + operation.slice(1)
        } client: ${result[0].name}`,
        metadata: { email: result[0].email, status: result[0].status },
      });
    }

    res.status(200).json({
      success: true,
      message: `Client ${operation} successfully`,
      data: {
        id: result[0].id,
        name: result[0].name,
        email: result[0].email,
        image: result[0].image,
        phone: result[0].phone,
        cpfcnpj: result[0].cpfcnpj,
        businessIndustry: result[0].businessIndustry,
        address: result[0].address,
        socialMediaLinks: result[0].socialMediaLinks,
        status: result[0].status,
        createdAt: result[0].createdAt,
        updatedAt: result[0].updatedAt,
      },
    });
  } catch (error) {
    console.error("Error upserting client:", error);
    res.status(500).json({
      error: "Internal server error while upserting client",
    });
  }
};
