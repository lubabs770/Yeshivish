import { describe, it, expect } from "vitest";
import { decide } from "../src/gateway.js";
import type { GroupMeCallback } from "../src/types.js";

const cfg = { groupme: { allowed_sender_id: "U" } } as any;

function msg(over: Partial<GroupMeCallback>): GroupMeCallback {
  return {
    id: "1", text: "hi", name: "n", sender_id: "U", sender_type: "user",
    group_id: "G", created_at: 0, attachments: [], ...over,
  };
}

function deps(pending = false) {
  return { cfg, seen: new Set<string>(), hasPending: () => pending };
}

describe("decide", () => {
  it("ignores messages from other senders", () => {
    expect(decide(msg({ sender_id: "X" }), deps()).kind).toBe("ignore");
  });

  it("ignores bot-authored messages", () => {
    expect(decide(msg({ sender_type: "bot" }), deps()).kind).toBe("ignore");
  });

  it("ignores duplicate message ids", () => {
    const d = deps();
    decide(msg({ id: "dup" }), d);
    expect(decide(msg({ id: "dup" }), d).kind).toBe("ignore");
  });

  it("routes YES to a confirm:true when a permission is pending", () => {
    expect(decide(msg({ text: "yes" }), deps(true))).toEqual({
      kind: "confirm", allowed: true,
    });
  });

  it("routes NO to a confirm:false when a permission is pending", () => {
    expect(decide(msg({ text: "no" }), deps(true))).toEqual({
      kind: "confirm", allowed: false,
    });
  });

  it("routes a slash message to a command", () => {
    expect(decide(msg({ text: "/new" }), deps())).toEqual({
      kind: "command", text: "/new",
    });
  });

  it("routes plain text to a prompt", () => {
    expect(decide(msg({ text: "do a thing" }), deps())).toEqual({
      kind: "prompt", text: "do a thing",
    });
  });

  it("ignores empty/null text", () => {
    expect(decide(msg({ text: null }), deps()).kind).toBe("ignore");
  });

  it("bounds the seen set, evicting the oldest id past the limit", () => {
    const d = deps();
    // Feed more ids than the 1000-entry cap; the set must stay bounded.
    for (let i = 0; i < 1100; i++) decide(msg({ id: `m${i}` }), d);
    expect(d.seen.size).toBeLessThanOrEqual(1000);
    // The oldest ids were evicted, so they are no longer deduped.
    expect(d.seen.has("m0")).toBe(false);
    expect(d.seen.has("m1099")).toBe(true);
  });
});
