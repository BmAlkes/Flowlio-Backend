import type { RequestHandler } from "express";
import { z } from "zod";
import { connection } from "../../configs/connection.config";
import { createProposalConversion, ConversionError } from "../../modules/proposals/project-conversion";
import { logger } from "../../utils/logger.util";

const conversion = createProposalConversion(connection);
const idSchema = z.string().min(1).max(128);
export const previewProposalProject: RequestHandler = async (req,res) => {
  const id = idSchema.safeParse(req.params.id);
  const template = idSchema.optional().safeParse(req.query.templateId);
  if (!id.success || !template.success) { res.status(400).json({success:false,code:"INVALID_PROJECT_DRAFT"}); return; }
  try { res.json({success:true,data:await conversion.preview(req.user!,id.data,template.data)}); }
  catch(error) { handleError(error,res); }
};
export const convertProposalProject: RequestHandler = async (req,res) => {
  const id=idSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({success:false,code:"INVALID_PROJECT_DRAFT"}); return; }
  try { const data=await conversion.convert(req.user!,id.data,req.body); res.status(data.existing?200:201).json({success:true,data}); }
  catch(error) { handleError(error,res); }
};
function handleError(error: unknown, res: Parameters<RequestHandler>[1]) {
  if (error instanceof ConversionError) { res.status(error.status).json({success:false,code:error.code}); return; }
  logger.error({ error }, "Proposal conversion failed");
  res.status(500).json({success:false,code:"CONVERSION_FAILED"});
}
