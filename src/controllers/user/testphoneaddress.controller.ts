import { Request, Response } from "express";
import { database } from "@/configs/connection.config";
import { users } from "@/schema/schema";
import { eq } from "drizzle-orm";
import status from "http-status";

// GET endpoint to fetch user profile with phone and address
export const getUserProfile = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;

    const user = await database
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        address: users.address,
        image: users.image,
        role: users.role,
        twoFactorEnabled: users.twoFactorEnabled,
        notificationPreferences: users.notificationPreferences,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      res.status(404).json({
        success: false,
        message: "User not found",
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: {
        user: user[0],
      },
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// POST endpoint to test phone and address update
export const testPhoneAddressUpdate = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    if (!req.user || !req.user.id) {
      res.status(401).json({
        success: false,
        message: "Authentication required",
      });
      return;
    }

    const userId = req.user.id;
    const { phone, address } = req.body;

    const updateData: any = {
      updatedAt: new Date(),
    };

    if (phone !== undefined) {
      updateData.phone = phone === "" ? null : phone;
    }

    if (address !== undefined) {
      updateData.address = address === "" ? null : address;
    }

    const updatedUser = await database
      .update(users)
      .set(updateData)
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        address: users.address,
        updatedAt: users.updatedAt,
      });

    res.status(200).json({
      success: true,
      message: "Phone and address updated successfully",
      data: {
        user: updatedUser[0],
      },
    });
  } catch (error) {
    console.error("Error updating phone and address:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
