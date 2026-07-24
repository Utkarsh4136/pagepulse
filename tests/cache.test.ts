import {
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  clearAuditCache,
  getCachedAudit,
  getCacheSize,
  setCachedAudit,
} from "../src/services/cache.service.js";

import type { AuditResult } from "../src/types/audit.js";

describe("Audit cache", () => {
  beforeEach(() => {
    clearAuditCache();
  });

  const result: AuditResult = {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    statusCode: 200,
    responseTimeMs: 100,

    title: {
      value: "Example Domain",
      length: 14,
    },

    metaDescription: {
      value: null,
      length: 0,
    },

    headings: {
      h1: ["Example Domain"],
      h2Count: 0,
    },

    links: {
      total: 1,
      internal: 0,
      external: 1,
    },

    images: {
      total: 0,
      withoutAlt: 0,
    },

    page: {
      htmlSizeBytes: 1000,
      canonical: null,
      robots: null,
    },

    issues: [],

    auditedAt: "2026-07-25T00:00:00.000Z",
  };

  it("stores and retrieves an audit", () => {
    setCachedAudit(result.url, result);

    const cached = getCachedAudit(result.url);

    expect(cached).toEqual(result);
  });

  it("reports cache size", () => {
    expect(getCacheSize()).toBe(0);

    setCachedAudit(result.url, result);

    expect(getCacheSize()).toBe(1);
  });

  it("clears cached audits", () => {
    setCachedAudit(result.url, result);

    clearAuditCache();

    expect(getCachedAudit(result.url)).toBeUndefined();
    expect(getCacheSize()).toBe(0);
  });
});