import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import {
  users,
  userOrganizations,
  account,
  userManagement,
} from "@/schema/schema";
import crypto from "crypto";
import { createUserMemberSchema } from "@/schema/validation";
import formidable from "formidable";
import { uploadToCloudinary } from "@/utils/cloudinary.util";
import { logActivity } from "@/utils/activity.util";
import { canCreateUser } from "@/utils/plan-access.util";

export const createUserMember = async (req: Request, res: Response) => {
  try {
    let fields: formidable.Fields;
    let files: formidable.Files;

    // Check if this is a multipart form or regular JSON
    const contentType = req.headers["content-type"] || "";

    logger.info("🔍 Request details:", {
      contentType,
      method: req.method,
      url: req.url,
      headers: req.headers,
      bodyType: typeof req.body,
      bodyKeys: req.body ? Object.keys(req.body) : "no body",
    });

    if (contentType.includes("multipart/form-data")) {
      // Handle file upload with formidable
      const form = formidable({
        maxFileSize: 5 * 1024 * 1024, // 5MB
        allowEmptyFiles: false,
        filter: ({ name, mimetype }) => {
          // Only allow image files
          if (name === "profileImage") {
            return Boolean(mimetype && mimetype.includes("image"));
          }
          return true;
        },
      });

      [fields, files] = await new Promise<
        [formidable.Fields, formidable.Files]
      >((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) {
            logger.error("❌ Formidable parsing error:", err);
            reject(err);
          } else {
            resolve([fields, files]);
          }
        });
      });
    } else {
      // Fallback to regular JSON parsing
      fields = req.body as any;
      files = {};
      logger.info("🔍 Using JSON fallback parsing");
    }

    // Debug: Log what we received
    logger.info("🔍 Formidable parsing results:", {
      fields: JSON.stringify(fields, null, 2),
      files: JSON.stringify(files, null, 2),
      fieldsKeys: Object.keys(fields),
      filesKeys: Object.keys(files),
    });

    // Extract form fields
    const extractedFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        key,
        Array.isArray(value) ? value[0] : value,
      ])
    );

    // Debug: Log extracted fields
    logger.info("🔍 Extracted fields:", {
      extractedFields: JSON.stringify(extractedFields, null, 2),
      extractedKeys: Object.keys(extractedFields),
    });

    // Log the request user information for debugging
    logger.info("🔍 CreateUserMember - Request user data:", {
      userId: req.user?.id,
      userEmail: req.user?.email,
      organizationId: req.user?.organizationId,
      userRole: req.user?.role,
      isSuperAdmin: req.user?.isSuperAdmin,
      fullUserObject: JSON.stringify(req.user, null, 2),
    });

    // Validate extracted fields
    logger.info("🔍 Attempting validation with schema:", {
      schemaFields: Object.keys(createUserMemberSchema.shape),
      extractedFieldsKeys: Object.keys(extractedFields),
    });

    const validationResult = createUserMemberSchema.safeParse(extractedFields);
    if (!validationResult.success) {
      logger.error("❌ Validation failed:", {
        errors: validationResult.error.errors,
        extractedFields: extractedFields,
      });
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationResult.error.errors,
      });
    }

    const {
      firstname,
      lastname,
      email,
      phonenumber,
      userrole,
      position,
      companyname,
      setpermission,
      password,
    } = validationResult.data;

    // Handle profile image upload
    let imageUrl = null;
    let imagePublicId = null;
    if (
      files.profileImage &&
      Array.isArray(files.profileImage) &&
      files.profileImage[0]
    ) {
      try {
        const uploadResult = await uploadToCloudinary(
          files.profileImage[0],
          "user-profiles"
        );
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
        logger.info("📸 Profile image uploaded successfully:", {
          imageUrl,
          imagePublicId,
        });
      } catch (uploadError) {
        logger.error("❌ Failed to upload profile image:", uploadError);
        // Continue without image if upload fails
      }
    }

    // Get organization ID from authenticated user
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      logger.error("❌ CreateUserMember - No organization ID found for user:", {
        userId: req.user?.id,
        userEmail: req.user?.email,
        isSuperAdmin: req.user?.isSuperAdmin,
        fullUserObject: JSON.stringify(req.user, null, 2),
      });

      return res.status(400).json({
        success: false,
        message:
          "User is not associated with an organization. Please make sure you are logged into an organization.",
      });
    }

    // Check plan limit for user creation
    const planCheck = await canCreateUser(organizationId);
    if (!planCheck.hasAccess) {
      logger.warn(
        `⚠️ User creation blocked for organization ${organizationId}: ${planCheck.reason}`
      );
      return res.status(403).json({
        success: false,
        message: planCheck.reason || "User limit reached for your plan",
        data: {
          currentCount: planCheck.currentCount,
          maxAllowed: planCheck.maxAllowed,
        },
      });
    }

    // Check if user already exists with this email
    const existingUser = await database.query.users.findFirst({
      where: (user, { eq }) => eq(user.email, email),
    });

    if (existingUser) {
      return res.status(200).json({
        success: true,
        message: "If this email is available, an invitation will be sent.",
      });
    }

    // Generate a unique user ID
    const userId = crypto.randomUUID().replace(/-/g, "");
    const now = new Date();

    // Create user directly in database (Better Auth will handle the rest)
    // Child users (team members) should have "active" status since the parent organization
    // already has an active subscription - they don't need to pay separately
    const [newUser] = await database
      .insert(users)
      .values({
        id: userId,
        name: `${firstname} ${lastname}`,
        email: email,
        role: userrole,
        isSuperAdmin: false,
        subadminId: null,
        emailVerified: false,
        status: "active", // Child users are active by default (parent org already paid)
        image: imageUrl,
        position: position,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Create user-organization relationship
    const [userOrg] = await database
      .insert(userOrganizations)
      .values({
        id: crypto.randomUUID().replace(/-/g, ""),
        userId: userId,
        organizationId: organizationId,
        role: userrole,
        permissions: {
          canManageUsers:
            setpermission === "edit" || setpermission === "delete",
          canManageProjects:
            setpermission === "edit" || setpermission === "delete",
          canManageBilling: setpermission === "delete",
          canViewAnalytics: true,
          canInviteUsers:
            setpermission === "edit" || setpermission === "delete",
        },
        status: "active",
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Use Better Auth's built-in password hashing
    const { auth } = await import("@/lib/auth");
    const context = await auth.$context;
    const hashedPassword = await context.password.hash(password);

    // Create account record for Better Auth
    const [userAccount] = await database
      .insert(account)
      .values({
        id: crypto.randomUUID().replace(/-/g, ""),
        accountId: userId,
        providerId: "credential",
        userId: userId,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info("🔐 Account created for Better Auth:", {
      accountId: userAccount.id,
      userId: userAccount.userId,
      providerId: userAccount.providerId,
      hasPassword: !!userAccount.password,
      passwordLength: userAccount.password?.length,
    });

    // Log image upload status
    if (imageUrl) {
      logger.info("📸 Profile image uploaded and saved:", {
        imageUrl,
        imagePublicId,
        userId,
      });
    }

    // Also store in userManagement table for your custom tracking
    const [userMemberRecord] = await database
      .insert(userManagement)
      .values({
        id: crypto.randomUUID().replace(/-/g, ""),
        firstname: firstname,
        lastname: lastname,
        email: email,
        phonenumber: phonenumber,
        userrole: userrole,
        companyname: companyname,
        setpermission: setpermission,
        position: position,
        password: hashedPassword, // Store Better Auth hashed password
        organizationId: organizationId,
        status: "active",
        isActive: true,
        createdBy: req.user?.id || userId, // Use current user ID or created user ID
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    logger.info(
      `User member created successfully: ${userId} in organization: ${organizationId}${
        imageUrl ? " with profile image" : ""
      }`
    );

    logger.info("🔍 User member record created in userManagement table:", {
      id: userMemberRecord.id,
      email: userMemberRecord.email,
      userrole: userMemberRecord.userrole,
      organizationId: userMemberRecord.organizationId,
      status: userMemberRecord.status,
      isActive: userMemberRecord.isActive,
      createdBy: userMemberRecord.createdBy,
    });

    // Debug: Log all created records for verification
    logger.info("📋 Final user member creation summary:", {
      user: {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
        image: newUser.image,
      },
      account: {
        id: userAccount.id,
        userId: userAccount.userId,
        providerId: userAccount.providerId,
        hasPassword: !!userAccount.password,
      },
      userOrganization: {
        id: userOrg.id,
        userId: userOrg.userId,
        organizationId: userOrg.organizationId,
        role: userOrg.role,
      },
      userManagement: {
        id: userMemberRecord.id,
        email: userMemberRecord.email,
        organizationId: userMemberRecord.organizationId,
        image: newUser.image,
      },
    });

    // Log activity
    const actorId = req.user?.id;
    if (organizationId && actorId) {
      await logActivity({
        organizationId,
        actorId,
        userId,
        type: "user",
        action: "create",
        resource: "user",
        resourceId: userId,
        message: `Added new user: ${firstname} ${lastname} (${email})`,
        metadata: { role: userrole, permission: setpermission },
      });
    }

    return res.status(201).json({
      success: true,
      message: "User member created successfully",
      data: {
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          image: newUser.image,
        },
        userOrganization: userOrg,
        account: userAccount,
        userManagement: {
          id: userMemberRecord.id,
          firstname: userMemberRecord.firstname,
          lastname: userMemberRecord.lastname,
          email: userMemberRecord.email,
          phonenumber: userMemberRecord.phonenumber,
          userrole: userMemberRecord.userrole,
          companyname: userMemberRecord.companyname,
          setpermission: userMemberRecord.setpermission,
          position: userMemberRecord.position,
          status: userMemberRecord.status,
          isActive: userMemberRecord.isActive,
          organizationId: userMemberRecord.organizationId,
          createdBy: userMemberRecord.createdBy,
          image: newUser.image, // Use the image from the user record
        },
      },
    });
  } catch (error) {
    logger.error("Error creating user member:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while creating user member",
      error: process.env.NODE_ENV === "development" ? error : undefined,
    });
  }
};
