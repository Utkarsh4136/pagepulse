import { LRUCache } from "lru-cache";

import { env } from "../config/env.js";
import type { AuditResult } from "../types/audit.js";

const auditCache = new LRUCache<string, AuditResult>({
  max: env.CACHE_MAX_ITEMS,
  ttl: env.CACHE_TTL_SECONDS * 1000,
});

export function getCachedAudit(
  url: string
): AuditResult | undefined {
  return auditCache.get(url);
}

export function setCachedAudit(
  url: string,
  result: AuditResult
): void {
  auditCache.set(url, result);
}

export function deleteCachedAudit(url: string): boolean {
  return auditCache.delete(url);
}

export function clearAuditCache(): void {
  auditCache.clear();
}

export function getCacheSize(): number {
  return auditCache.size;
}