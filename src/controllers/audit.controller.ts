import type {
  NextFunction,
  Request,
  Response,
} from "express";

import { auditRequestSchema } from "../schemas/audit.schema.js";
import { auditUrl } from "../services/audit.service.js";
import {
  getCachedAudit,
  setCachedAudit,
} from "../services/cache.service.js";
import { auditSemaphore } from "../services/concurrency.service.js";
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

    // Check the cache before performing an expensive audit.
    const cachedResult = getCachedAudit(normalizedUrl);

    if (cachedResult) {
      res.status(200).json({
        success: true,
        cached: true,
        data: cachedResult,
      });

      return;
    }

    // Only a configured number of audits can execute simultaneously.
    const result = await auditSemaphore.run(() =>
      auditUrl(normalizedUrl)
    );

    // Store successful audits in cache.
    setCachedAudit(normalizedUrl, result);

    res.status(200).json({
      success: true,
      cached: false,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}