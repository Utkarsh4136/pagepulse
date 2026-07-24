import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";

describe("POST /api/v1/audits - SSRF protection", () => {
  it("rejects localhost", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({
        url: "http://localhost:3000",
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_TARGET");
  });

  it("rejects loopback IP addresses", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({
        url: "http://127.0.0.1:3000",
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_TARGET");
  });

  it("rejects private IPv4 addresses", async () => {
    const response = await request(app)
      .post("/api/v1/audits")
      .send({
        url: "http://192.168.1.1",
      })
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe("INVALID_TARGET");
  });
});