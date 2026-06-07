// src/turn-queue.ts
type Task = (signal: AbortSignal) => Promise<void>;

// Serializes agent turns so only one runs at a time. abortCurrent() cancels the
// in-flight task via its AbortSignal (used by /stop).
export class TurnQueue {
  private chain: Promise<void> = Promise.resolve();
  private current: AbortController | null = null;

  enqueue(task: Task): void {
    this.chain = this.chain.then(async () => {
      const ac = new AbortController();
      this.current = ac;
      try {
        await task(ac.signal);
      } catch (err) {
        console.error("turn failed:", err);
      } finally {
        this.current = null;
      }
    });
  }

  abortCurrent(): boolean {
    if (!this.current) return false;
    this.current.abort();
    return true;
  }

  // Resolves when the current chain of work has drained (test helper).
  idle(): Promise<void> {
    return this.chain;
  }
}
