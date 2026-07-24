import { describe, expect, it } from "vitest";

import { Semaphore } from "../src/utils/semaphore.js";

describe("Semaphore", () => {
  it("never exceeds the configured concurrency limit", async () => {
    const semaphore = new Semaphore(2);

    let active = 0;
    let maximumActive = 0;

    const task = async () => {
      await semaphore.run(async () => {
        active += 1;

        maximumActive = Math.max(
          maximumActive,
          active
        );

        await new Promise((resolve) =>
          setTimeout(resolve, 30)
        );

        active -= 1;
      });
    };

    await Promise.all([
      task(),
      task(),
      task(),
      task(),
      task(),
    ]);

    expect(maximumActive).toBe(2);
    expect(semaphore.getActiveCount()).toBe(0);
    expect(semaphore.getQueueLength()).toBe(0);
  });

  it("releases a slot when a task throws", async () => {
    const semaphore = new Semaphore(1);

    await expect(
      semaphore.run(async () => {
        throw new Error("Test failure");
      })
    ).rejects.toThrow("Test failure");

    expect(semaphore.getActiveCount()).toBe(0);
  });
});