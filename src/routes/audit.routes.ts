import { Router } from "express";

import { createAudit } from "../controllers/audit.controller.js";
import { auditRateLimiter } from "../middleware/rateLimit.middleware.js";

export const auditRouter = Router();

auditRouter.post(
  "/",
  auditRateLimiter,
  createAudit
);