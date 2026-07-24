import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("Request ID middleware", () => {
  it("generates a request ID", async () => {
    const response = await request(app)
      .get("/")
      .expect(200);

    expect(response.body.requestId).toEqual(
      expect.any(String)
    );

    expect(response.headers["x-request-id"]).toBe(
      response.body.requestId
    );
  });

  it("preserves a supplied request ID", async () => {
    const requestId = "pagepulse-test-123";

    const response = await request(app)
      .get("/")
      .set("x-request-id", requestId)
      .expect(200);

    expect(response.body.requestId).toBe(requestId);
    expect(response.headers["x-request-id"]).toBe(requestId);
  });
});