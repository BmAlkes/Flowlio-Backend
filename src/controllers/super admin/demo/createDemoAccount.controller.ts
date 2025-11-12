import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import {
  organizations,
  users,
  userOrganizations,
  account,
} from "@/schema/schema";
import { logger } from "@/utils/logger.util";
import status from "http-status";
import crypto from "crypto";
import { eq } from "drizzle-orm";

export const createDemoAccount = async (req: Request, res: Response) => {
  try {
    const {
      email,
      name,
      password,
      trialDays = 14,
      role = "viewer",
    } = req.body as {
      email: string;
      name: string;
      password: string;
      trialDays?: number;
      role?: string;
    };

    if (!email || !name || !password) {
      res.status(status.BAD_REQUEST).json({
        success: false,
        message: "name, email, and password are required",
      });
      return;
    }

    const now = new Date();
    const trialEndsAt = new Date(
      now.getTime() + trialDays * 24 * 60 * 60 * 1000
    );

    // Create demo organization
    const orgId = crypto.randomUUID();
    const slugBase = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const slug = `${slugBase}-demo-${orgId.slice(0, 6)}`;

    await database.insert(organizations).values({
      id: orgId,
      name: `${name} Demo`,
      slug,
      description: "Demo organization",
      status: "active",
      subscriptionStatus: "active",
      trialEndsAt,
      settings: {
        timezone: "UTC",
        dateFormat: "MM/DD/YYYY",
        currency: "USD",
        language: "en",
        notifications: {
          email: true,
          push: true,
          sms: false,
        },
        demo: true,
        demoCreatedAt: now.toISOString(),
        demoCreatedBy: req.user?.id ?? null,
        demoRole: role,
        passwordChanged: false, // Track if demo user has changed password
      },
    });

    // Check if user already exists
    const existingUsers = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let createdUserId: string | null = null;

    if (existingUsers.length > 0) {
      // If user exists, just attach to organization as viewer/member
      createdUserId = existingUsers[0].id;
      await database.insert(userOrganizations).values({
        id: crypto.randomUUID(),
        userId: createdUserId,
        organizationId: orgId,
        role: role === "viewer" ? "viewer" : "member",
        status: "active",
      });
    } else {
      // Create a full user account with login credentials
      const userId = crypto.randomUUID().replace(/-/g, "");

      // Create user record
      await database.insert(users).values({
        id: userId,
        name: name,
        email: email,
        emailVerified: true, // Auto-verify for demo accounts
        role: role === "viewer" ? "viewer" : "user",
        isSuperAdmin: false,
        subadminId: null,
        createdAt: now,
        updatedAt: now,
      });

      // Hash password using Better Auth's password hashing
      const { auth } = await import("@/lib/auth");
      const context = await auth.$context;
      const hashedPassword = await context.password.hash(password);

      // Create account record for Better Auth authentication
      await database.insert(account).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        accountId: userId,
        providerId: "credential",
        userId: userId,
        password: hashedPassword,
        createdAt: now,
        updatedAt: now,
      });

      // Link user to demo organization
      await database.insert(userOrganizations).values({
        id: crypto.randomUUID(),
        userId: userId,
        organizationId: orgId,
        role: role === "viewer" ? "viewer" : "member",
        status: "active",
      });

      createdUserId = userId;
    }

    logger.info(`🎟️ Demo account created for ${email} under org ${orgId}`);

    res.status(status.CREATED).json({
      success: true,
      message: "Demo account created successfully",
      data: {
        organizationId: orgId,
        organizationSlug: slug,
        trialEndsAt,
        userId: createdUserId,
        email,
        password, // Return password so super admin can share it (this is for demo accounts only)
        role: role === "viewer" ? "viewer" : "user",
      },
    });
  } catch (error) {
    logger.error("Error creating demo account:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
