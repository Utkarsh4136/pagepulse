import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { requestIdMiddleware } from "./middleware/requestId.middleware.js";
import { requestLoggerMiddleware } from "./middleware/requestLogger.middleware.js";
import { auditRouter } from "./routes/audit.routes.js";
import { getCacheSize } from "./services/cache.service.js";
import { auditSemaphore } from "./services/concurrency.service.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());
app.use(cors());

app.use(
  express.json({
    limit: "10kb",
  })
);

// Must come before routes so every request receives an ID.
app.use(requestIdMiddleware);

// Logger uses the request ID created above.
app.use(requestLoggerMiddleware);

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "PagePulse",
    version: "1.0.0",
    description: "Production-grade URL audit service",
    status: "running",
    requestId: res.locals.requestId,
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),

    cache: {
      entries: getCacheSize(),
      maxEntries: env.CACHE_MAX_ITEMS,
      ttlSeconds: env.CACHE_TTL_SECONDS,
    },

    concurrency: {
      active: auditSemaphore.getActiveCount(),
      queued: auditSemaphore.getQueueLength(),
      limit: env.MAX_CONCURRENT_AUDITS,
    },
  });
});

app.use("/api/v1/audits", auditRouter);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    requestId: res.locals.requestId,
    error: {
      code: "NOT_FOUND",
      message: "The requested endpoint does not exist.",
    },
  });
});

// Error handler must remain last.
app.use(errorHandler);