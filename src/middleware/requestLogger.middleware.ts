import type {
  NextFunction,
  Request,
  Response,
} from "express";

import { logger } from "../utils/logger.js";

export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const startedAt = performance.now();

  logger.info(
    {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
    },
    "Request started"
  );

  res.on("finish", () => {
    const durationMs = Math.round(
      performance.now() - startedAt
    );

    logger.info(
      {
        requestId: res.locals.requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      },
      "Request completed"
    );
  });

  next();
}