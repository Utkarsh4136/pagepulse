import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("POST /api/v1/audits - validation", () => {
  it("rejects a missing URL", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({})
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body).toHaveProperty("requestId");
  });

  it("rejects an invalid URL", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({
        url: "hello",
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects unsupported protocols", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({
        url: "ftp://example.com",
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});