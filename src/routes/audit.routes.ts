import { Router } from "express";

import { createAudit } from "../controllers/audit.controller.js";

export const auditRouter = Router();

auditRouter.post("/", createAudit);