import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

  MAX_CONCURRENT_AUDITS: z.coerce.number().int().positive().default(10),

  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  CACHE_MAX_ITEMS: z.coerce.number().int().positive().default(500),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment configuration:",
    parsed.error.flatten().fieldErrors
  );

  process.exit(1);
}

export const env = parsed.data;