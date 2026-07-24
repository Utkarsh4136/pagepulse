import dns from "node:dns/promises";
import net from "node:net";

import { AppError } from "./appError.js";

const blockedHostnames = new Set([
  "localhost",
  "localhost.localdomain",
]);

interface ResolvedAddress {
  address: string;
  family: number;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => Number.isNaN(part))
  ) {
    return false;
  }

  const [a, b] = parts;

  if (a === undefined || b === undefined) {
    return false;
  }

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);

  if (version === 4) {
    return isPrivateIPv4(ip);
  }

  if (version === 6) {
    return isPrivateIPv6(ip);
  }

  return true;
}

export async function validateTargetUrl(
  rawUrl: string
): Promise<void> {
  const url = new URL(rawUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new AppError(
      400,
      "INVALID_PROTOCOL",
      "Only HTTP and HTTPS URLs are supported."
    );
  }

  const hostname = url.hostname.toLowerCase();

  if (blockedHostnames.has(hostname)) {
    throw new AppError(
      400,
      "INVALID_TARGET",
      "Local or private network targets are not allowed."
    );
  }

  // If the hostname itself is already an IP address,
  // validate it without performing DNS lookup.
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new AppError(
        400,
        "INVALID_TARGET",
        "Local or private network targets are not allowed."
      );
    }

    return;
  }

  let addresses: ResolvedAddress[];

  try {
    addresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new AppError(
      502,
      "DNS_LOOKUP_FAILED",
      "The target hostname could not be resolved."
    );
  }

  if (addresses.length === 0) {
    throw new AppError(
      502,
      "DNS_LOOKUP_FAILED",
      "The target hostname could not be resolved."
    );
  }

  const containsBlockedAddress = addresses.some(
    ({ address }) => isBlockedIp(address)
  );

  if (containsBlockedAddress) {
    throw new AppError(
      400,
      "INVALID_TARGET",
      "Local or private network targets are not allowed."
    );
  }
}