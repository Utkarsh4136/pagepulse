import { rateLimit } from "express-rate-limit";

import { env } from "../config/env.js";

export const auditRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,

  standardHeaders: "draft-8",
  legacyHeaders: false,

  handler: (_req, res) => {
    res.status(429).json({
      success: false,
      requestId: res.locals.requestId,
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message:
          "Too many audit requests. Please try again later.",
      },
    });
  },
});