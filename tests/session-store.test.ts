import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "yesh-")), "state.json");
});

describe("SessionStore", () => {
  it("starts with no current session", () => {
    const store = new SessionStore(path);
    expect(store.currentSessionId()).toBeNull();
  });

  it("sets and persists the current session id", () => {
    new SessionStore(path).setCurrent("abc");
    expect(new SessionStore(path).currentSessionId()).toBe("abc");
  });

  it("clearCurrent drops the id but keeps it in recent", () => {
    const store = new SessionStore(path);
    store.setCurrent("abc");
    store.clearCurrent();
    expect(store.currentSessionId()).toBeNull();
  });

  it("recordCompleted prepends to recent (newest first, deduped)", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    store.recordCompleted("b");
    store.recordCompleted("a");
    expect(store.listRecent(5).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("resume(undefined) returns the most recent id and makes it current", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    store.recordCompleted("b");
    expect(store.resume()).toBe("b");
    expect(store.currentSessionId()).toBe("b");
  });

  it("resume(id) returns that id when present, null otherwise", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    expect(store.resume("a")).toBe("a");
    expect(store.resume("zzz")).toBeNull();
  });
});
