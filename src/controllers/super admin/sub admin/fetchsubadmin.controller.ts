import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";
import { subadmin, users } from "@/schema/schema";
import { eq } from "drizzle-orm";

export const fetchSubAdmins = async (_: Request, res: Response) => {
  try {
    // Fetch subadmins with their associated user data (for image)
    const subadmins = await database
      .select({
        id: subadmin.id,
        firstName: subadmin.firstName,
        lastName: subadmin.lastName,
        email: subadmin.email,
        contactNumber: subadmin.contactNumber,
        permission: subadmin.permission,
        logo: subadmin.logo,
        createdAt: subadmin.createdAt,
        user: {
          id: users.id,
          image: users.image,
        },
      })
      .from(subadmin)
      .leftJoin(users, eq(users.subadminId, subadmin.id));

    // Map the results to include image from either logo or user.image
    const mappedSubadmins = subadmins.map((sub) => ({
      ...sub,
      image: sub.logo || sub.user?.image || null,
    }));

    res.status(200).json({
      message: "Sub Admin fetched successfully",
      data: mappedSubadmins,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
