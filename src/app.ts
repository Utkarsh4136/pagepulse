import express from "express";
import cors from "cors";
import helmet from "helmet";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10kb" }));

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "PagePulse",
    version: "1.0.0",
    description: "Production-grade URL audit service",
    status: "running",
  });
});

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});