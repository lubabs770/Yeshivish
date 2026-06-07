import { describe, it, expect, vi } from "vitest";
import { TurnQueue } from "../src/turn-queue.js";

describe("TurnQueue", () => {
  it("runs tasks serially in order", async () => {
    const q = new TurnQueue();
    const log: number[] = [];
    const mk = (n: number) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      log.push(n);
    };
    q.enqueue(mk(1));
    q.enqueue(mk(2));
    await q.idle();
    expect(log).toEqual([1, 2]);
  });

  it("abortCurrent aborts the in-flight task's signal", async () => {
    const q = new TurnQueue();
    let aborted = false;
    q.enqueue(async (signal) => {
      await new Promise((r) => setTimeout(r, 20));
      aborted = signal.aborted;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(q.abortCurrent()).toBe(true);
    await q.idle();
    expect(aborted).toBe(true);
  });

  it("abortCurrent returns false when idle", () => {
    expect(new TurnQueue().abortCurrent()).toBe(false);
  });
});
