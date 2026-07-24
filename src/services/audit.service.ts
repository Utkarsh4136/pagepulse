import * as cheerio from "cheerio";

import type {
  AuditIssue,
  AuditResult,
} from "../types/audit.js";

import { fetchPage } from "./fetch.service.js";

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export async function auditUrl(url: string): Promise<AuditResult> {
  const fetchResult = await fetchPage(url);

  const $ = cheerio.load(fetchResult.html);

  const titleValue = cleanText($("title").first().text()) || null;

  const metaDescriptionValue =
    $("meta[name='description']").attr("content")?.trim() || null;

  const canonical =
    $("link[rel='canonical']").attr("href")?.trim() || null;

  const robots =
    $("meta[name='robots']").attr("content")?.trim() || null;

  const h1 = $("h1")
    .map((_index, element) => cleanText($(element).text()))
    .get()
    .filter(Boolean);

  const h2Count = $("h2").length;

  let internalLinks = 0;
  let externalLinks = 0;

  const baseUrl = new URL(fetchResult.finalUrl);

  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");

    if (!href) {
      return;
    }

    try {
      const link = new URL(href, baseUrl);

      if (!["http:", "https:"].includes(link.protocol)) {
        return;
      }

      if (link.hostname === baseUrl.hostname) {
        internalLinks += 1;
      } else {
        externalLinks += 1;
      }
    } catch {
      // Ignore malformed links found inside the target page.
    }
  });

  const totalImages = $("img").length;

  let imagesWithoutAlt = 0;

  $("img").each((_index, element) => {
    const alt = $(element).attr("alt");

    if (alt === undefined || alt.trim() === "") {
      imagesWithoutAlt += 1;
    }
  });

  const issues: AuditIssue[] = [];

  if (!titleValue) {
    issues.push({
      category: "SEO",
      severity: "error",
      message: "Page title is missing.",
    });
  } else if (titleValue.length > 60) {
    issues.push({
      category: "SEO",
      severity: "warning",
      message: "Page title is longer than 60 characters.",
    });
  }

  if (!metaDescriptionValue) {
    issues.push({
      category: "SEO",
      severity: "warning",
      message: "Meta description is missing.",
    });
  } else if (metaDescriptionValue.length > 160) {
    issues.push({
      category: "SEO",
      severity: "warning",
      message: "Meta description is longer than 160 characters.",
    });
  }

  if (h1.length === 0) {
    issues.push({
      category: "CONTENT",
      severity: "warning",
      message: "No H1 heading was found.",
    });
  }

  if (h1.length > 1) {
    issues.push({
      category: "CONTENT",
      severity: "info",
      message: `The page contains ${h1.length} H1 headings.`,
    });
  }

  if (imagesWithoutAlt > 0) {
    issues.push({
      category: "ACCESSIBILITY",
      severity: "warning",
      message: `${imagesWithoutAlt} image(s) are missing useful alt text.`,
    });
  }

  if (fetchResult.responseTimeMs > 3000) {
    issues.push({
      category: "PERFORMANCE",
      severity: "warning",
      message: "The initial HTML response took more than 3 seconds.",
    });
  }

  return {
    url,
    finalUrl: fetchResult.finalUrl,
    statusCode: fetchResult.statusCode,
    responseTimeMs: fetchResult.responseTimeMs,

    title: {
      value: titleValue,
      length: titleValue?.length ?? 0,
    },

    metaDescription: {
      value: metaDescriptionValue,
      length: metaDescriptionValue?.length ?? 0,
    },

    headings: {
      h1,
      h2Count,
    },

    links: {
      total: internalLinks + externalLinks,
      internal: internalLinks,
      external: externalLinks,
    },

    images: {
      total: totalImages,
      withoutAlt: imagesWithoutAlt,
    },

    page: {
      htmlSizeBytes: Buffer.byteLength(fetchResult.html, "utf8"),
      canonical,
      robots,
    },

    issues,

    auditedAt: new Date().toISOString(),
  };
}