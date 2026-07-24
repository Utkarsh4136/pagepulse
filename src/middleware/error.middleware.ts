import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";

import { AppError } from "../utils/appError.js";
import { logger } from "../utils/logger.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const requestId = res.locals.requestId;

  if (error instanceof AppError) {
    logger.warn(
      {
        requestId,
        method: req.method,
        path: req.originalUrl,
        statusCode: error.statusCode,
        errorCode: error.code,
      },
      error.message
    );

    res.status(error.statusCode).json({
      success: false,
      requestId,
      error: {
        code: error.code,
        message: error.message,

        ...(error.details !== undefined && {
          details: error.details,
        }),
      },
    });

    return;
  }

  logger.error(
    {
      requestId,
      method: req.method,
      path: req.originalUrl,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    },
    "Unhandled application error"
  );

  res.status(500).json({
    success: false,
    requestId,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};