import { Request, Response } from "express";
import { database } from "../../../configs/connection.config";
import { clients, users, account } from "../../../schema/schema";
import { uploadToCloudinary } from "../../../utils/cloudinary.util";
import { eq, and } from "drizzle-orm";
import { logActivity } from "@/utils/activity.util";
import { logger } from "@/utils/logger.util";
import { auth } from "@/lib/auth";
import crypto from "crypto";

export const updateClient = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const userReq = req as any;
    if (!userReq.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id: clientId } = req.params;
    if (!clientId) {
      res.status(400).json({ error: "Client ID is required" });
      return;
    }

    const organizationId = userReq.user.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "Organization ID is required" });
      return;
    }

    const {
      name,
      email,
      password,
      phone,
      cpfcnpj,
      businessIndustry,
      address,
      socialMediaLinks,
      status,
      image,
      customFields,
      portalAccessEnabled,
    } = req.body;

    const existingClient = await database
      .select()
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.organizationId, organizationId)))
      .limit(1);

    if (existingClient.length === 0) {
      res.status(404).json({ error: "Client not found or access denied" });
      return;
    }

    const currentClient = existingClient[0];

    if (email && email !== currentClient.email) {
      const emailConflict = await database
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (emailConflict.length > 0) {
        res.status(409).json({ error: "Another user with this email already exists" });
        return;
      }
    }

    let imageUrl = currentClient.image || null;
    let imagePublicId = currentClient.imagePublicId || null;

    if (image && typeof image === "string" && image.startsWith("data:image")) {
      try {
        const uploadResult = await uploadToCloudinary(image, "clients");
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        logger.error("Image upload failed:", uploadError);
        res.status(500).json({ error: "Failed to upload client image" });
        return;
      }
    }

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

    // Hash new password if provided (≥8 chars required)
    let hashedPassword: string | null = null;
    if (password && typeof password === "string" && password.length >= 8) {
      try {
        const authContext = await auth.$context;
        hashedPassword = await authContext.password.hash(password);
      } catch (hashError) {
        logger.error("Failed to hash client password:", hashError);
        res.status(500).json({ error: "Failed to process the new password" });
        return;
      }
    }

    const result = await database.transaction(async (tx) => {
      // 1. Update user record if name or email changed
      if (
        currentClient.userId &&
        ((name && name !== currentClient.name) || (email && email !== currentClient.email))
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

      // 2. Update (or create) credential account password
      if (hashedPassword) {
        let resolvedUserId = currentClient.userId as string | null;

        if (!resolvedUserId) {
          // Legacy client with no user account — create user + credential account now
          // so they can start using the portal with this password.
          const clientEmail = (email || currentClient.email) as string;
          const now = new Date();

          // Check if a user with this email already exists (edge case)
          const [existingUser] = await tx
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, clientEmail))
            .limit(1);

          if (existingUser) {
            // Re-use the existing user — just link it and update/create the credential account
            resolvedUserId = existingUser.id;
            await tx.update(clients).set({ userId: resolvedUserId }).where(eq(clients.id, clientId));
            logger.info(`[updateClient] linked existing user ${resolvedUserId} to legacy client ${clientId}`);
          } else {
            // Create brand-new user + link
            resolvedUserId = crypto.randomUUID().replace(/-/g, "");
            await tx.insert(users).values({
              id: resolvedUserId,
              name: (name || currentClient.name) as string,
              email: clientEmail,
              emailVerified: false,
              twoFactorEnabled: false,
              isSuperAdmin: false,
              role: "client",
              status: "active",
              image: imageUrl,
              createdAt: now,
              updatedAt: now,
            });
            await tx.update(clients).set({ userId: resolvedUserId }).where(eq(clients.id, clientId));
            logger.info(`[updateClient] created user+account for legacy client ${clientId} userId=${resolvedUserId}`);
          }

          // Create or update credential account for the resolved user
          const [existingCredAccount] = await tx
            .select({ id: account.id })
            .from(account)
            .where(and(eq(account.userId, resolvedUserId), eq(account.providerId, "credential")))
            .limit(1);

          if (existingCredAccount) {
            await tx.update(account).set({ password: hashedPassword, updatedAt: now }).where(eq(account.id, existingCredAccount.id));
          } else {
            await tx.insert(account).values({
              id: crypto.randomUUID().replace(/-/g, ""),
              accountId: resolvedUserId,
              providerId: "credential",
              userId: resolvedUserId,
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            });
          }
        } else {
          // Client already has a user — update or create the credential account
          const existingAccount = await tx
            .select({ id: account.id })
            .from(account)
            .where(
              and(
                eq(account.userId, resolvedUserId),
                eq(account.providerId, "credential"),
              ),
            )
            .limit(1);

          if (existingAccount.length > 0) {
            await tx
              .update(account)
              .set({ password: hashedPassword, updatedAt: new Date() })
              .where(eq(account.id, existingAccount[0].id));
            logger.info(`[updateClient] password updated account.id=${existingAccount[0].id}`);
          } else {
            const newAccountId = crypto.randomUUID().replace(/-/g, "");
            await tx.insert(account).values({
              id: newAccountId,
              accountId: resolvedUserId,
              providerId: "credential",
              userId: resolvedUserId,
              password: hashedPassword,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            logger.info(`[updateClient] credential account created account.id=${newAccountId}`);
          }
        }
      }

      // 3. Update client record
      // portalAccessEnabled is only added to SET if a value is available — guards against
      // the column not yet existing in the DB (migration pending) so basic edits never break
      const portalAccessValue =
        portalAccessEnabled !== undefined
          ? Boolean(portalAccessEnabled)
          : currentClient.portalAccessEnabled;

      const [updatedClient] = await tx
        .update(clients)
        .set({
          name: name || currentClient.name,
          email: email || currentClient.email,
          phone: phone !== undefined ? phone : currentClient.phone,
          cpfcnpj: cpfcnpj !== undefined ? cpfcnpj : currentClient.cpfcnpj,
          businessIndustry:
            businessIndustry !== undefined ? businessIndustry : currentClient.businessIndustry,
          address: address !== undefined ? address : currentClient.address,
          socialMediaLinks: parsedSocialMediaLinks,
          customFields: parsedCustomFields,
          status: status || currentClient.status,
          image: imageUrl,
          imagePublicId,
          ...(portalAccessValue !== undefined ? { portalAccessEnabled: portalAccessValue } : {}),
          updatedAt: new Date(),
        })
        .where(eq(clients.id, clientId))
        .returning();

      return updatedClient;
    });

    if (!result) {
      res.status(500).json({ error: "Failed to update client" });
      return;
    }

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
        portalAccessEnabled: result.portalAccessEnabled,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;
    logger.error("Error updating client:", { message: errMsg, stack: errStack });
    res.status(500).json({ error: "Internal server error while updating client" });
  }
};
