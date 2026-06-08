import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, validateConfig, expandHome } from "../src/config.js";

function tmpFile(contents: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "yesh-cfg-")), "config.yaml");
  writeFileSync(p, contents);
  return p;
}

const VALID = `
groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" }
agent: { workspace_dir: "~/ws", model: "claude-opus-4-8", max_turns: 30, auto_allow_read_tools: true }
server: { port: 8787 }
tunnel: { mode: "named", hostname: "h" }
`;

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~/ws")).toBe(join(homedir(), "ws"));
  });
  it("leaves absolute paths untouched", () => {
    expect(expandHome("/tmp/x")).toBe("/tmp/x");
  });
});

describe("loadConfig", () => {
  it("loads and expands workspace_dir", () => {
    const cfg = loadConfig(tmpFile(VALID));
    expect(cfg.groupme.bot_id).toBe("B");
    expect(cfg.agent.workspace_dir).toBe(join(homedir(), "ws"));
  });

  it("defaults ingest and poll when an older config omits them", () => {
    const cfg = loadConfig(tmpFile(VALID));
    expect(cfg.ingest.mode).toBe("webhook");
    expect(cfg.poll).toEqual({ idle_ms: 10000, active_ms: 1000, decay_ms: 15000 });
  });

  it("preserves explicit ingest and poll values", () => {
    const withPoll =
      VALID +
      `ingest: { mode: "poll" }\npoll: { idle_ms: 5000, active_ms: 500, decay_ms: 8000 }\n`;
    const cfg = loadConfig(tmpFile(withPoll));
    expect(cfg.ingest.mode).toBe("poll");
    expect(cfg.poll.active_ms).toBe(500);
  });
});

describe("validateConfig", () => {
  it("returns no errors for a complete config", () => {
    expect(validateConfig(loadConfig(tmpFile(VALID)))).toEqual([]);
  });
  it("reports missing required groupme fields", () => {
    const bad = loadConfig(tmpFile(VALID));
    bad.groupme.bot_id = "";
    expect(validateConfig(bad)).toContain("groupme.bot_id is required");
  });
});

describe("saveConfig", () => {
  it("round-trips through YAML", () => {
    const p = tmpFile(VALID);
    const cfg = loadConfig(p);
    cfg.agent.model = "claude-haiku-4-5-20251001";
    saveConfig(p, cfg);
    expect(readFileSync(p, "utf8")).toContain("claude-haiku-4-5-20251001");
  });
});
