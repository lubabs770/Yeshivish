// src/sms-rules.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Behavioral rules injected both as systemPrompt.append and via the workspace
// CLAUDE.md, so replies stay SMS-friendly.
export const SMS_RULES = [
  "You are replying to the user over SMS (through GroupMe). Follow these rules:",
  "- Plain text only. No markdown, no code fences, no bullet characters, no tables, no headings.",
  "- Be concise. Answer in a few short sentences; every character costs an SMS.",
  "- Long output is split across multiple texts, so minimize length and summarize instead of dumping.",
  "- No links or emoji unless asked. Lead with the answer; skip preamble.",
].join("\n");

export const CLAUDE_MD = `# Workspace instructions

${SMS_RULES}
`;

// Ensure the workspace dir exists and seed CLAUDE.md once. Never overwrites an
// existing CLAUDE.md so the user can edit it as the source of truth.
export function bootstrapWorkspace(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const claudeMd = join(dir, "CLAUDE.md");
  if (!existsSync(claudeMd)) writeFileSync(claudeMd, CLAUDE_MD);
}
