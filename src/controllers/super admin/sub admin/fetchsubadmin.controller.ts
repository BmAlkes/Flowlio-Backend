import { database } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { Request, Response } from "express";
import status from "http-status";

export const fetchSubAdmins = async (_: Request, res: Response) => {
  try {
    const subadmin = await database.query.subadmin.findMany();

    res.status(200).json({
      message: "Sub Admin fetched successfully",
      data: subadmin,
    });
  } catch (error) {
    logger.error(error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      message: (error as Error)?.message ?? "Internal server error",
    });
  }
};
