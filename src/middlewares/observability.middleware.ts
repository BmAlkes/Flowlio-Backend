import { requestContext } from "@/modules/observability/context";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { observability } from "@/modules/observability/runtime";
import { releaseVersion, routeLabel } from "@/modules/observability/privacy";

export const observeRequest: RequestHandler = (req,res,next) => {
  const correlationId=randomUUID();
  const started=performance.now();
  res.locals.correlationId=correlationId;
  res.setHeader("X-Request-Id",correlationId);
  res.setHeader("X-App-Version",releaseVersion());
  res.once("finish",()=>{
    if (req.originalUrl.startsWith("/api/observability") || req.originalUrl.startsWith("/api/health")) return;
    const elapsed=performance.now()-started;
    observability.metric("api",req.user?.organizationId,res.statusCode>=500,elapsed);
    if (res.statusCode>=500) void observability.record({source:"api",organizationId:req.user?.organizationId,
      code:"HTTP_SERVER_ERROR",route:routeLabel(req.route?.path),correlationId,status:res.statusCode,durationMs:elapsed});
  });
  requestContext.run({ correlationId, release:releaseVersion() }, next);
};
