import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from "express";

import { AppError } from "../utils/appError.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
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

  console.error("Unhandled error:", error);

  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  });
};