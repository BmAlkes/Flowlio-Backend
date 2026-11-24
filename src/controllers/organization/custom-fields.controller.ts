import type { Request, Response } from "express";
import { connection } from "@/configs/connection.config";
import { logger } from "@/utils/logger.util";
import { createCustomFields, CustomFieldError } from "../../modules/custom-fields/service";

const service = createCustomFields(connection);

async function respond(res: Response, work: () => Promise<unknown>, message: string) {
  try {
    res.status(200).json({ success: true, message, data: await work() });
  } catch (error) {
    if (error instanceof CustomFieldError) {
      res.status(error.status).json({ success: false, code: error.code, message: error.message });
      return;
    }
    logger.error({ error }, "Custom field request failed");
    res.status(500).json({ success: false, message: "Internal server error" });
  }
}

export const createCustomFieldDefinition = (req: Request, res: Response) => respond(res, () => service.create(req.user!, req.body), "Custom field created successfully");
export const getCustomFieldDefinitions = (req: Request, res: Response) => respond(res, () => service.list(req.user!, req.query.entityType), "Custom fields fetched successfully");
export const updateCustomFieldDefinition = (req: Request, res: Response) => respond(res, () => service.update(req.user!, req.params.id, req.body), "Custom field updated successfully");
export const deleteCustomFieldDefinition = (req: Request, res: Response) => respond(res, () => service.remove(req.user!, req.params.id), "Custom field deleted successfully");
export const setTaskCustomFieldValues = (req: Request, res: Response) => respond(res, () => service.setTaskValues(req.user!, req.params.id, req.body), "Task fields updated");
