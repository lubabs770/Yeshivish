import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";
import { runTurn } from "../src/agent.js";

function fakeStream(messages: any[]) {
  return async function* () {
    for (const m of messages) yield m;
  };
}

let store: SessionStore;
beforeEach(() => {
  store = new SessionStore(join(mkdtempSync(join(tmpdir(), "yesh-")), "s.json"));
});

const cfg = {
  agent: { workspace_dir: "/ws", model: "m", max_turns: 5, auto_allow_read_tools: true },
} as any;
const broker = { canUseTool: vi.fn() } as any;

describe("runTurn", () => {
  it("accumulates assistant text and captures the session id", async () => {
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([
        { type: "system", subtype: "init", session_id: "S1" },
        { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
        { type: "result", session_id: "S1", subtype: "success" },
      ]))(),
    );

    const res = await runTurn("hi", { cfg, store, broker, queryFn });
    expect(res.text).toBe("Hello");
    expect(res.sessionId).toBe("S1");
    expect(store.currentSessionId()).toBe("S1");
  });

  it("passes resume when a session is current", async () => {
    store.setCurrent("PREV");
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([{ type: "result", session_id: "PREV", subtype: "success" }]))(),
    );
    await runTurn("again", { cfg, store, broker, queryFn });
    const opts = queryFn.mock.calls[0][0].options;
    expect(opts.resume).toBe("PREV");
    expect(opts.cwd).toBe("/ws");
    expect(opts.canUseTool).toBeTypeOf("function");
  });

  it("omits resume when no session is current", async () => {
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([{ type: "result", session_id: "NEW", subtype: "success" }]))(),
    );
    await runTurn("first", { cfg, store, broker, queryFn });
    expect(queryFn.mock.calls[0][0].options.resume).toBeUndefined();
  });
});
