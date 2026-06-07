import { describe, it, expect, vi } from "vitest";
import { createSender } from "../src/groupme.js";

const cfg = {
  groupme: { bot_id: "BOT", access_token: "TOK", group_id: "G", allowed_sender_id: "U" },
} as any;

describe("createSender", () => {
  it("posts a single message to bots/post with bot_id and text", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await createSender(cfg, fetchFn).send("hi");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.groupme.com/v3/bots/post");
    expect(JSON.parse(init.body)).toEqual({ bot_id: "BOT", text: "hi" });
  });

  it("splits long text into multiple posts", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await createSender(cfg, fetchFn).send("x".repeat(2000));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("retries once on failure then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });
    await createSender(cfg, fetchFn).send("hi");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
