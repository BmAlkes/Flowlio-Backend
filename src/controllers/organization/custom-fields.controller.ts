import { Request, Response } from "express";
import { customFieldDefinitions } from "../../schema/schema";
import { eq, and } from "drizzle-orm";
import status from "http-status";
import { database } from "@/configs/connection.config";
import { createCustomFieldDefinitionSchema, updateCustomFieldDefinitionSchema } from "../../schema/validation";

const DEFAULT_COLOR = "#3b82f6"; // Blue

export const createCustomFieldDefinition = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as any).user.organizationId;
    const validatedData = createCustomFieldDefinitionSchema.parse(req.body);
    const { name, type, options, entityType = "project" } = validatedData;

    // Ensure options have colors if type is select
    let processedOptions = options;
    if (type === "select" && options) {
      processedOptions = options.map((opt: any) => ({
        label: opt.label,
        color: opt.color || DEFAULT_COLOR,
      }));
    }

    const [newField] = await database
      .insert(customFieldDefinitions)
      .values({
        organizationId,
        entityType,
        name,
        type,
        options: processedOptions,
      })
      .returning();

     res.status(status.OK).json({ success: true, message: "Custom field created successfully", data: newField });
     return;
  } catch (error) {
    console.error("Error creating custom field:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
    return;
  }
};

export const getCustomFieldDefinitions = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as any).user.organizationId;
    const { entityType = "project" } = req.query;

    const fields = await database
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.organizationId, organizationId),
          eq(customFieldDefinitions.entityType, String(entityType))
        )
      );

      res.status(status.OK).json({ success: true, message: "Custom fields fetched successfully", data: fields });
      return;
  } catch (error) {
    console.error("Error fetching custom fields:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
    return;
  }
};

export const updateCustomFieldDefinition = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as any).user.organizationId;
    const { id } = req.params;
    const validatedData = updateCustomFieldDefinitionSchema.parse(req.body);
    const { name, options } = validatedData;

    // Get current field to check type
    const [currentField] = await database
      .select()
      .from(customFieldDefinitions)
      .where(eq(customFieldDefinitions.id, id));

    let processedOptions = options;
    if (currentField && currentField.type === "select" && options) {
      processedOptions = options.map((opt: any) => ({
        label: opt.label,
        color: opt.color || DEFAULT_COLOR,
      }));
    }

    const [updatedField] = await database
      .update(customFieldDefinitions)
      .set({
        name,
        options: processedOptions,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.organizationId, organizationId)
        )
      )
      .returning();

    if (!updatedField) {
       res.status(status.NOT_FOUND).json({ success: false, message: "Custom field not found" });
       return;
    }

    res.status(status.OK).json({ success: true, message: "Custom field updated successfully", data: updatedField });
    return;
  } catch (error) {
    console.error("Error updating custom field:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
    return;
  }
};

export const deleteCustomFieldDefinition = async (req: Request, res: Response): Promise<void> => {
  try {
    const organizationId = (req as any).user.organizationId;
    const { id } = req.params;

    const [deletedField] = await database
      .delete(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, id),
          eq(customFieldDefinitions.organizationId, organizationId)
        )
      )
      .returning();

    if (!deletedField) {
      res.status(status.NOT_FOUND).json({ success: false, message: "Custom field not found" });
      return;
    }

    res.status(status.OK).json({ success: true, message: "Custom field deleted successfully" });
    return;
  } catch (error) {
    console.error("Error deleting custom field:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({ success: false, message: "Internal server error" });
    return;
  }
};
