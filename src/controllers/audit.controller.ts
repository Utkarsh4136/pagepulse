import type {
  NextFunction,
  Request,
  Response,
} from "express";

import { auditRequestSchema } from "../schemas/audit.schema.js";
import { auditUrl } from "../services/audit.service.js";
import { AppError } from "../utils/appError.js";
import { normalizeUrl } from "../utils/url.js";

export async function createAudit(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = auditRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        400,
        "VALIDATION_ERROR",
        "Invalid audit request.",
        parsed.error.flatten().fieldErrors
      );
    }

    const normalizedUrl = normalizeUrl(parsed.data.url);

    const result = await auditUrl(normalizedUrl);

    res.status(200).json({
      success: true,
      cached: false,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}