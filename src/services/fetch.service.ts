import axios from "axios";

import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";
import { validateTargetUrl } from "../utils/urlSecurity.js";

export interface FetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  responseTimeMs: number;
}

export async function fetchPage(url: string): Promise<FetchResult> {
  await validateTargetUrl(url);

  const startedAt = performance.now();

  try {
    const response = await axios.get<string>(url, {
      timeout: env.REQUEST_TIMEOUT_MS,

      maxRedirects: 5,

      maxContentLength: 2 * 1024 * 1024,

      responseType: "text",

      headers: {
        "User-Agent":
          "PagePulse/1.0 (+Production URL Audit Service)",
        Accept: "text/html,application/xhtml+xml",
      },

      validateStatus: (status) => status >= 200 && status < 400,
    });

    const responseTimeMs = Math.round(performance.now() - startedAt);

    const contentType = String(response.headers["content-type"] ?? "");

    if (!contentType.toLowerCase().includes("text/html")) {
      throw new AppError(
        415,
        "UNSUPPORTED_CONTENT_TYPE",
        "The target URL did not return an HTML document."
      );
    }

    return {
      html: response.data,
      finalUrl: response.request?.res?.responseUrl ?? url,
      statusCode: response.status,
      responseTimeMs,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (axios.isAxiosError(error)) {
      if (error.code === "ECONNABORTED") {
        throw new AppError(
          504,
          "TARGET_TIMEOUT",
          `The target website did not respond within ${env.REQUEST_TIMEOUT_MS}ms.`
        );
      }

      if (error.response) {
        throw new AppError(
          502,
          "TARGET_HTTP_ERROR",
          `The target website responded with HTTP ${error.response.status}.`
        );
      }

      throw new AppError(
        502,
        "TARGET_UNREACHABLE",
        "The target website could not be reached."
      );
    }

    throw error;
  }
}