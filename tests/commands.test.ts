import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";
import { isCommand, handleCommand } from "../src/commands.js";

let store: SessionStore;
beforeEach(() => {
  store = new SessionStore(join(mkdtempSync(join(tmpdir(), "yesh-")), "s.json"));
});

describe("isCommand", () => {
  it("detects a leading slash", () => {
    expect(isCommand("/new")).toBe(true);
    expect(isCommand("hello")).toBe(false);
  });
});

describe("handleCommand", () => {
  it("/new clears the current session", () => {
    store.setCurrent("abc");
    const res = handleCommand("/new", { store });
    expect(store.currentSessionId()).toBeNull();
    expect(res.reply).toMatch(/new session/i);
  });

  it("/resume with no recent sessions reports nothing to resume", () => {
    const res = handleCommand("/resume", { store });
    expect(res.reply).toMatch(/no .*session/i);
  });

  it("/resume restores the most recent session", () => {
    store.recordCompleted("a");
    store.recordCompleted("b");
    const res = handleCommand("/resume", { store });
    expect(store.currentSessionId()).toBe("b");
    expect(res.reply).toMatch(/b/);
  });

  it("/stop signals an abort", () => {
    expect(handleCommand("/stop", { store }).abort).toBe(true);
  });

  it("/help lists commands", () => {
    expect(handleCommand("/help", { store }).reply).toMatch(/\/new/);
  });

  it("unknown command returns a hint", () => {
    expect(handleCommand("/wat", { store }).reply).toMatch(/unknown/i);
  });
});
