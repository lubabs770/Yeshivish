// src/config.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Config } from "./types.js";

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

// Parse the YAML config and expand ~ in workspace_dir. Does not validate;
// call validateConfig separately so the GUI can show field-level errors.
export function loadConfig(path: string): Config {
  const cfg = yaml.load(readFileSync(path, "utf8")) as Config;
  cfg.agent.workspace_dir = expandHome(cfg.agent.workspace_dir);
  return cfg;
}

export function saveConfig(path: string, cfg: Config): void {
  writeFileSync(path, yaml.dump(cfg));
}

// Returns a list of human-readable problems; empty array means valid.
export function validateConfig(cfg: Config): string[] {
  const errors: string[] = [];
  const required: [string, unknown][] = [
    ["groupme.access_token", cfg.groupme.access_token],
    ["groupme.bot_id", cfg.groupme.bot_id],
    ["groupme.group_id", cfg.groupme.group_id],
    ["groupme.allowed_sender_id", cfg.groupme.allowed_sender_id],
    ["agent.workspace_dir", cfg.agent.workspace_dir],
  ];
  for (const [name, value] of required) {
    if (!value) errors.push(`${name} is required`);
  }
  return errors;
}
