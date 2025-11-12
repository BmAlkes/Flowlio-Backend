import { type IRateLimiterStoreNoAutoExpiryOptions } from "rate-limiter-flexible";
import { RateLimiterPostgres, RateLimiterMemory } from "rate-limiter-flexible";
import { database, connection } from "@/configs/connection.config";
import { throttleinsight } from "@/schema/schema";
import type { RequestHandler } from "express";
import { env } from "@/utils/env.util";
import { status } from "http-status";

interface IOverRideOptions
  extends Omit<IRateLimiterStoreNoAutoExpiryOptions, "storeClient"> {
  errorMessage?: string;
}

const options: IRateLimiterStoreNoAutoExpiryOptions = {
  dbName: env.DATABASE_NAME,
  storeClient: connection,
  tableName: "throttle",
  blockDuration: 10, // seconds
  storeType: "pg",
  keyPrefix: "",
  duration: 60, // per seconds
  points: 50, // requests
};

type Throttle = <O = IOverRideOptions | "default">(
  overRideOptions: O
) => RequestHandler;

export const throttle: Throttle = (overRideOptions) => {
  const limiter = new RateLimiterPostgres({
    ...options,
    ...(overRideOptions === "default"
      ? {}
      : {
          ...overRideOptions,
          insuranceLimiter: new RateLimiterMemory({
            blockDuration: (overRideOptions as IOverRideOptions).blockDuration,
            keyPrefix: (overRideOptions as IOverRideOptions).keyPrefix,
            duration: (overRideOptions as IOverRideOptions).duration,
            points: (overRideOptions as IOverRideOptions).points,
          }),
        }),
  });

  return async (req, res, next) => {
    try {
      await limiter.consume(req.ip!);
      next();
    } catch (error) {
      const afterConsumption = await limiter.get(req.ip!);

      if (afterConsumption) {
        const {
          msBeforeNext,
          consumedPoints,
          remainingPoints,
          isFirstInDuration,
        } = afterConsumption;

        const values = {
          msBeforeNext,
          consumedPoints,
          remainingPoints,
          isFirstInDuration,
          endPoint: req.path,
          waitTime: msBeforeNext / 1000,
        };

        await database
          .insert(throttleinsight)
          .values({
            key: req.ip!,
            pointsAllotted: limiter.duration,
            ...values,
          })
          .onConflictDoUpdate({
            target: throttleinsight.key,
            set: values,
          });
      }

      const customErrorMessage =
        overRideOptions &&
        typeof overRideOptions === "object" &&
        "errorMessage" in overRideOptions
          ? (overRideOptions?.errorMessage as string)
          : undefined;

      res
        .status(status.TOO_MANY_REQUESTS)
        .json({ message: customErrorMessage ?? "Too many requests" });
    }
  };
};
