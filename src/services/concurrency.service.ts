import { env } from "../config/env.js";
import { Semaphore } from "../utils/semaphore.js";

export const auditSemaphore = new Semaphore(
  env.MAX_CONCURRENT_AUDITS
);