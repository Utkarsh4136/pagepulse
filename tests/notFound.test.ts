import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("404 handler", () => {
  it("returns a structured error for unknown endpoints", async () => {
    const response = await request(app)
      .get("/does-not-exist")
      .expect(404);

    expect(response.body.success).toBe(false);

    expect(response.body.error).toEqual({
      code: "NOT_FOUND",
      message: "The requested endpoint does not exist.",
    });

    expect(response.body).toHaveProperty("requestId");
  });
});