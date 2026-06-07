import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMS_RULES, CLAUDE_MD, bootstrapWorkspace } from "../src/sms-rules.js";

describe("SMS rules content", () => {
  it("mentions no markdown and conciseness", () => {
    expect(SMS_RULES.toLowerCase()).toContain("markdown");
    expect(SMS_RULES.toLowerCase()).toContain("concise");
  });
  it("CLAUDE_MD embeds the rules", () => {
    expect(CLAUDE_MD).toContain(SMS_RULES);
  });
});

describe("bootstrapWorkspace", () => {
  it("creates the dir and writes CLAUDE.md when absent", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "yesh-ws-")), "nested");
    bootstrapWorkspace(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(CLAUDE_MD);
  });
  it("does not overwrite an existing CLAUDE.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "yesh-ws-"));
    writeFileSync(join(dir, "CLAUDE.md"), "custom");
    bootstrapWorkspace(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("custom");
  });
});
