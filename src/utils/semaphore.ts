export class Semaphore {
  private activeCount = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
      throw new Error(
        "Semaphore maxConcurrency must be a positive integer."
      );
    }
  }

  async acquire(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return this.createReleaseFunction();
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });

    this.activeCount += 1;

    return this.createReleaseFunction();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();

    try {
      return await task();
    } finally {
      release();
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  private createReleaseFunction(): () => void {
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeCount -= 1;

      const next = this.queue.shift();

      if (next) {
        next();
      }
    };
  }
}