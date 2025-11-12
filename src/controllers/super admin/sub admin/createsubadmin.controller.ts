import { extractFormFields } from "@/utils/formdata.utils";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import { Request, Response } from "express";
import formidable from "formidable";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { account, createSubAdminSchema, subadmin, users } from "@/schema";

export const createSubAdmin = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      logger.error("No authenticated user found in request");
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const creatorId = req.user.id;
    // logger.info(`Creating sub admin by user: ${creatorId}`);

    const form = formidable();
    const [fields, files] = await new Promise<
      [formidable.Fields, formidable.Files]
    >((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const extractedFields = extractFormFields<
      typeof subadmin.$inferSelect & { userId?: string }
    >(fields);

    let logoUrl = null;
    let logoPublicId = null;
    if (files.logo && Array.isArray(files.logo) && files.logo[0]) {
      const uploadResult = await uploadToCloudinary(
        files.logo[0],
        "subadmin-logo"
      );
      logoUrl = uploadResult.secure_url;
      logoPublicId = uploadResult.public_id;
    }

    const validationResult = createSubAdminSchema.safeParse(extractedFields);
    if (!validationResult.success) {
      logger.error("Validation error:", validationResult.error.issues);
      res.status(400).json({
        success: false,
        message: "Validation Error",
        errors: validationResult.error.issues,
      });
      return;
    }

    const validatedData = validationResult.data;

    const existingUser = await database.query.users.findFirst({
      where: (t, { eq }) => eq(t.email, validatedData.email),
      columns: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        isSuperAdmin: true,
        role: true,
        subadminId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (existingUser) {
      // Check if user has wrong providerId and fix it
      const existingAccount = await database.query.account.findFirst({
        where: (t, { eq }) => eq(t.userId, existingUser.id),
        columns: {
          id: true,
          providerId: true,
          password: true,
        },
      });

      if (existingAccount && existingAccount.providerId === "email") {
        // Fix the existing account with Better Auth's password hashing
        const { auth } = await import("@/lib/auth");
        const context = await auth.$context;
        const hashedPassword = await context.password.hash(
          validatedData.password
        );

        await database
          .update(account)
          .set({
            providerId: "credential",
            password: hashedPassword,
            updatedAt: new Date(),
          })
          .where(eq(account.id, existingAccount.id));

        // logger.info(
        //   `Fixed existing account for user ${existingUser.id} - changed providerId from email to credentials with scrypt hash`
        // );

        return res.status(200).json({
          success: true,
          message: "Existing sub-admin account fixed and can now log in",
          data: {
            user: existingUser,
          },
        });
      }

      logger.error(`User with email ${validatedData.email} already exists`);
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    try {
      // Create user directly in the database since Better Auth is configured with emailOTP
      const [createdUser] = await database
        .insert(users)
        .values({
          id: crypto.randomUUID().replace(/-/g, ""),
          name: `${validatedData.firstName} ${validatedData.lastName}`,
          email: validatedData.email,
          emailVerified: false,
          isSuperAdmin: false,
          subadminId: null,
          role: "subadmin",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // logger.info(
      //   `User created directly in database: ${createdUser.id} with role: subadmin`
      // );

      // Use Better Auth's built-in password hashing
      const { auth } = await import("@/lib/auth");
      const context = await auth.$context;
      const hashedPassword = await context.password.hash(
        validatedData.password
      );

      // Wait a moment for Better Auth to potentially create an account
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check if Better Auth created an account and update it
      const existingAccount = await database.query.account.findFirst({
        where: (t, { eq }) => eq(t.userId, createdUser.id),
        columns: {
          id: true,
          providerId: true,
          password: true,
        },
      });

      if (existingAccount) {
        // Update the existing account to use credential provider
        await database
          .update(account)
          .set({
            providerId: "credential",
            password: hashedPassword,
            updatedAt: new Date(),
          })
          .where(eq(account.id, existingAccount.id));

        // logger.info(
        //   `Updated existing account for user ${createdUser.id} to use credential provider`
        // );
      } else {
        // Create account record for Better Auth with credential provider
        await database.insert(account).values({
          id: crypto.randomUUID().replace(/-/g, ""),
          accountId: createdUser.id,
          providerId: "credential",
          userId: createdUser.id,
          password: hashedPassword,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // logger.info(
        //   `Created account for user ${createdUser.id} with credential provider`
        // );
      }

      // Double-check and force update if still wrong
      const finalCheck = await database.query.account.findFirst({
        where: (t, { eq }) => eq(t.userId, createdUser.id),
        columns: {
          id: true,
          providerId: true,
          password: true,
        },
      });

      if (finalCheck && finalCheck.providerId === "email") {
        // Force update one more time
        await database
          .update(account)
          .set({
            providerId: "credential",
            password: hashedPassword,
            updatedAt: new Date(),
          })
          .where(eq(account.id, finalCheck.id));

        // logger.info(
        //   `Force updated account for user ${createdUser.id} to use credential provider`
        // );
      }

      // Generate subadmin ID in format: subadm_timestamp_randomstring
      const timestamp = Date.now();
      const randomString = Math.random().toString(36).substring(2, 15);
      const subadminId = `subadm_${timestamp}_${randomString}`;

      const [createdSubAdmin] = await database
        .insert(subadmin)
        .values({
          id: subadminId,
          firstName: validatedData.firstName,
          lastName: validatedData.lastName,
          email: validatedData.email,
          contactNumber: validatedData.contactNumber,
          permission: validatedData.permission,
          logo: logoUrl,
          logoPublicId: logoPublicId,
          createdBy: creatorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      // Update the user with the subadminId
      await database
        .update(users)
        .set({
          subadminId: createdSubAdmin.id,
          updatedAt: new Date(),
        })
        .where(eq(users.id, createdUser.id));

      // Verify the final user state
      const updatedUser = await database.query.users.findFirst({
        where: (t, { eq }) => eq(t.id, createdUser.id),
        columns: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          isSuperAdmin: true,
          role: true, // Include role in the response
          subadminId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // logger.info(
      //   `Sub admin created successfully - User ID: ${createdUser.id}, Sub Admin ID: ${createdSubAdmin.id}, Role: ${updatedUser?.role} by user: ${creatorId}`
      // );

      res.status(201).json({
        success: true,
        message: "Sub Admin created successfully and can now log in",
        data: {
          user: updatedUser, // Return updated user with subadminId and role
          subAdmin: createdSubAdmin,
        },
      });
    } catch (signupError) {
      logger.error("Better Auth signup failed:", signupError);
      return res.status(400).json({
        success: false,
        message: "Failed to create user account through Better Auth",
        error: signupError,
      });
    }
  } catch (error) {
    logger.error("Error creating sub admin:", error);
    res.status(500).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
