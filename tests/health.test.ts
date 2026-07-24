import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("GET /health", () => {
  it("returns the service health status", async () => {
    const response = await request(app)
      .get("/health")
      .expect(200);

    expect(response.body.status).toBe("ok");
    expect(response.body).toHaveProperty("uptime");
    expect(response.body).toHaveProperty("timestamp");

    expect(response.body.cache).toEqual(
      expect.objectContaining({
        entries: expect.any(Number),
        maxEntries: expect.any(Number),
        ttlSeconds: expect.any(Number),
      })
    );

    expect(response.body.concurrency).toEqual(
      expect.objectContaining({
        active: expect.any(Number),
        queued: expect.any(Number),
        limit: expect.any(Number),
      })
    );
  });
});