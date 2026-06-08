import { describe, it, expect, vi } from "vitest";
import { createPoller } from "../src/poller.js";

const cfg = {
  groupme: { bot_id: "BOT", access_token: "TOK", group_id: "G", allowed_sender_id: "U" },
  poll: { idle_ms: 10000, active_ms: 1000, decay_ms: 15000 },
} as any;

// A GroupMe read-API message with the given id (numeric string).
function msg(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    text: `m${id}`,
    name: "Sam",
    sender_id: "U",
    sender_type: "user",
    group_id: "G",
    created_at: Number(id),
    attachments: [],
    ...over,
  };
}

// Builds a fake fetch Response for the messages index endpoint.
function jsonRes(messages: unknown[], status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ response: { count: messages.length, messages } }),
  } as unknown as Response;
}

const notModified = { ok: false, status: 304, json: async () => ({}) } as unknown as Response;

describe("createPoller.pollOnce", () => {
  it("establishes a baseline on the first poll and dispatches nothing", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(jsonRes([msg("100")]));

    const poller = createPoller({ cfg, onCallback, fetchFn });
    const n = await poller.pollOnce();

    expect(n).toBe(0);
    expect(onCallback).not.toHaveBeenCalled();
  });

  it("dispatches messages after the baseline, mapped to a GroupMeCallback", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")])) // baseline
      .mockResolvedValueOnce(jsonRes([msg("101")]));

    const poller = createPoller({ cfg, onCallback, fetchFn });
    await poller.pollOnce();
    const n = await poller.pollOnce();

    expect(n).toBe(1);
    expect(onCallback).toHaveBeenCalledTimes(1);
    expect(onCallback).toHaveBeenCalledWith({
      id: "101",
      text: "m101",
      name: "Sam",
      sender_id: "U",
      sender_type: "user",
      group_id: "G",
      created_at: 101,
      attachments: [],
    });
  });

  it("dispatches a multi-message batch oldest-first regardless of API order", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")])) // baseline
      // GroupMe returns newest-first; ids are not lexicographically ordered.
      .mockResolvedValueOnce(jsonRes([msg("1001"), msg("999"), msg("101")]));

    const poller = createPoller({ cfg, onCallback, fetchFn });
    await poller.pollOnce();
    const n = await poller.pollOnce();

    expect(n).toBe(3);
    const orderById = onCallback.mock.calls.map((c) => c[0].id);
    expect(orderById).toEqual(["101", "999", "1001"]);
  });

  it("sends token and limit, and adds after_id once a cursor exists", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")]))
      .mockResolvedValueOnce(jsonRes([msg("102"), msg("101")]))
      .mockResolvedValueOnce(notModified);

    const poller = createPoller({ cfg, onCallback, fetchFn });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();

    const firstUrl = new URL(fetchFn.mock.calls[0][0]);
    expect(firstUrl.pathname).toBe("/v3/groups/G/messages");
    expect(firstUrl.searchParams.get("token")).toBe("TOK");
    expect(firstUrl.searchParams.get("limit")).toBe("20");
    expect(firstUrl.searchParams.get("after_id")).toBeNull();

    // After baseline (100) the cursor is 100.
    expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get("after_id")).toBe("100");
    // After dispatching 101 and 102 the cursor advances to the newest, 102.
    expect(new URL(fetchFn.mock.calls[2][0]).searchParams.get("after_id")).toBe("102");
  });

  it("treats HTTP 304 as no new messages without dispatching or throwing", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")]))
      .mockResolvedValueOnce(notModified)
      .mockResolvedValueOnce(jsonRes([msg("101")]));

    const poller = createPoller({ cfg, onCallback, fetchFn });
    await poller.pollOnce();
    const none = await poller.pollOnce();
    await poller.pollOnce();

    expect(none).toBe(0);
    expect(onCallback).toHaveBeenCalledTimes(1);
    // Cursor was not moved by the 304, so it still points at the baseline.
    expect(new URL(fetchFn.mock.calls[2][0]).searchParams.get("after_id")).toBe("100");
  });

  it("swallows a rejected fetch and leaves the cursor unchanged", async () => {
    const onCallback = vi.fn();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")]))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonRes([msg("101")]));

    const poller = createPoller({ cfg, onCallback, fetchFn });
    await poller.pollOnce();
    const n = await poller.pollOnce(); // must not throw
    await poller.pollOnce();

    expect(n).toBe(0);
    expect(new URL(fetchFn.mock.calls[2][0]).searchParams.get("after_id")).toBe("100");
    expect(onCallback).toHaveBeenCalledTimes(1);
  });
});

describe("createPoller scheduling", () => {
  it("polls immediately on start, then at idle_ms while quiet", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(notModified);
    const poller = createPoller({ cfg, onCallback: vi.fn(), fetchFn });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    poller.stop();
    vi.useRealTimers();
  });

  it("switches to active_ms after a message is dispatched", async () => {
    vi.useFakeTimers();
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")])) // baseline (no activity)
      .mockResolvedValueOnce(jsonRes([msg("101")])) // dispatches → activity
      .mockResolvedValue(notModified);
    const poller = createPoller({ cfg, onCallback: vi.fn(), fetchFn });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // baseline tick → idle schedule
    await vi.advanceTimersByTimeAsync(10000); // tick dispatches 101 → active schedule
    expect(fetchFn).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000); // next poll at active interval
    expect(fetchFn).toHaveBeenCalledTimes(3);

    poller.stop();
    vi.useRealTimers();
  });

  it("polls at active_ms while a confirmation is pending, even when quiet", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(notModified);
    const broker = { hasPending: () => true };
    const poller = createPoller({ cfg, onCallback: vi.fn(), fetchFn, broker });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);

    poller.stop();
    vi.useRealTimers();
  });

  it("drains immediately when a full page comes back", async () => {
    vi.useFakeTimers();
    const fullPage = Array.from({ length: 20 }, (_, i) => msg(String(200 + i)));
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonRes([msg("100")])) // baseline
      .mockResolvedValueOnce(jsonRes(fullPage)) // full page → drain now
      .mockResolvedValue(notModified);
    const poller = createPoller({ cfg, onCallback: vi.fn(), fetchFn });

    poller.start();
    await vi.advanceTimersByTimeAsync(0); // baseline
    await vi.advanceTimersByTimeAsync(10000); // full page
    await vi.advanceTimersByTimeAsync(0); // immediate drain poll
    expect(fetchFn).toHaveBeenCalledTimes(3);

    poller.stop();
    vi.useRealTimers();
  });

  it("stop() halts further polling", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn().mockResolvedValue(notModified);
    const poller = createPoller({ cfg, onCallback: vi.fn(), fetchFn });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    poller.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
