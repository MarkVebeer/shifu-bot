import type { Logger } from '../logger';

/**
 * Global queue for outgoing Discord messages. Limits how many sends run at once
 * across all servers. discord.js handles Discord's per route rate limits (429)
 * on top of this and waits for the bucket to reset.
 */
export class SendQueue {
  private readonly pending: { label: string; run: () => Promise<void> }[] = [];
  private active = 0;

  constructor(
    private readonly concurrency: number,
    private readonly logger: Logger,
    private readonly maxPending = 5_000,
  ) {}

  /** Returns false when the queue is full and the job was dropped. */
  push(label: string, run: () => Promise<void>): boolean {
    if (this.pending.length >= this.maxPending) {
      this.logger.warn('Send queue is full, dropping message', { label, pending: this.pending.length });
      return false;
    }
    this.pending.push({ label, run });
    this.drain();
    return true;
  }

  /** Run a job through the queue and wait for its result. */
  run<T>(label: string, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const accepted = this.push(label, async () => {
        try {
          resolve(await job());
        } catch (error) {
          reject(error);
        }
      });
      if (!accepted) reject(new Error('Send queue is full'));
    });
  }

  get size(): { active: number; pending: number } {
    return { active: this.active, pending: this.pending.length };
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const job = this.pending.shift();
      if (!job) return;
      this.active++;
      job
        .run()
        .catch((error) => this.logger.error('Queued job failed', { label: job.label, error }))
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}

/** Sliding window counter: at most `limit` events per key per window. */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
  ) {
    setInterval(() => this.prune(), windowMs).unref();
  }

  tryTake(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, times] of this.hits) {
      if (times.every((time) => now - time >= this.windowMs)) this.hits.delete(key);
    }
  }
}
