import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";
import { clientStatusSchema, projectStatusSchema } from "../contracts/core-api";
import { logger } from "../utils/logger.util";

/** Preserve existing error fields while making all core API failures identifiable. */
export const apiErrorEnvelope: RequestHandler = (_req, res, next) => {
  const send = res.json.bind(res);
  res.json = body => {
    if (res.statusCode >= 400 && body && typeof body === "object") {
      const codes: Record<number, string> = { 400: "VALIDATION_ERROR", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 429: "RATE_LIMITED" };
      body = { ...body, success: false, code: typeof body.code === "string" ? body.code : codes[res.statusCode] || "INTERNAL_ERROR",
        message: typeof body.message === "string" ? body.message : typeof body.error === "string" ? body.error : "Request failed" };
    }
    return send(body);
  };
  next();
};

export function validateDomainStatus(domain: "client" | "project"): RequestHandler {
  return (req, res, next) => {
    if (req.body?.status === undefined) { next(); return; }
    const result = (domain === "client" ? clientStatusSchema : projectStatusSchema).safeParse(req.body.status);
    if (!result.success) {
      res.status(400).json({ success: false, code: "INVALID_STATUS", message: `Invalid ${domain} status`,
        issues: [{ path: "status", message: `Choose a supported ${domain} status` }] }); return;
    }
    req.body.status = result.data;
    next();
  };
}

/** Read routes validate exactly the JSON representation sent over HTTP. */
export function contractResponse(schema: ZodTypeAny): RequestHandler {
  return (req, res, next) => {
    const send = res.json.bind(res);
    res.json = body => {
      if (res.statusCode < 400) {
        const result = schema.safeParse(JSON.parse(JSON.stringify(body)));
        if (!result.success) {
          logger.error({ route: req.route?.path, issues: result.error.issues.map(issue => ({ path: issue.path, code: issue.code })) }, "API response contract mismatch");
          return sendAfterFailure();
        }
        return send(result.data);
      }
      return send(body);
    };
    function sendAfterFailure() {
      res.status(500);
      return send({ success: false, code: "API_RESPONSE_INVALID", message: "The response could not be loaded. Please contact support." });
    }
    next();
  };
}
