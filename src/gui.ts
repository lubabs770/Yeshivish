// src/gui.ts
import type { Config } from "./types.js";

function esc(v: unknown): string {
  return String(v).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function field(name: string, value: unknown): string {
  return `<label>${name}<input name="${name}" value="${esc(value)}"></label>`;
}

// Renders a dead-simple HTML form pre-filled from the current config.
export function renderConfigForm(cfg: Config): string {
  const checked = cfg.agent.auto_allow_read_tools ? "checked" : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<title>yeshivish config</title>
<style>body{font-family:system-ui;max-width:40rem;margin:2rem auto}
label{display:block;margin:.5rem 0}input{width:100%}</style></head>
<body><h1>yeshivish config</h1>
<form method="post" action="/config">
${field("groupme.access_token", cfg.groupme.access_token)}
${field("groupme.bot_id", cfg.groupme.bot_id)}
${field("groupme.group_id", cfg.groupme.group_id)}
${field("groupme.allowed_sender_id", cfg.groupme.allowed_sender_id)}
${field("agent.workspace_dir", cfg.agent.workspace_dir)}
${field("agent.model", cfg.agent.model)}
${field("agent.max_turns", cfg.agent.max_turns)}
<label>agent.auto_allow_read_tools
<input type="checkbox" name="agent.auto_allow_read_tools" ${checked}></label>
${field("server.port", cfg.server.port)}
${field("tunnel.mode", cfg.tunnel.mode)}
${field("tunnel.hostname", cfg.tunnel.hostname)}
<button type="submit">Save</button>
</form></body></html>`;
}

// Maps a parsed form body (dotted keys) back into a Config, coercing numbers
// and the checkbox. Starts from `base` so untouched values survive.
export function formBodyToConfig(
  body: Record<string, string>,
  base: Config,
): Config {
  return {
    groupme: {
      access_token: body["groupme.access_token"] ?? base.groupme.access_token,
      bot_id: body["groupme.bot_id"] ?? base.groupme.bot_id,
      group_id: body["groupme.group_id"] ?? base.groupme.group_id,
      allowed_sender_id:
        body["groupme.allowed_sender_id"] ?? base.groupme.allowed_sender_id,
    },
    agent: {
      workspace_dir: body["agent.workspace_dir"] ?? base.agent.workspace_dir,
      model: body["agent.model"] ?? base.agent.model,
      max_turns: Number(body["agent.max_turns"] ?? base.agent.max_turns),
      auto_allow_read_tools: Boolean(body["agent.auto_allow_read_tools"]),
    },
    server: { port: Number(body["server.port"] ?? base.server.port) },
    tunnel: {
      mode: (body["tunnel.mode"] as "named" | "quick") ?? base.tunnel.mode,
      hostname: body["tunnel.hostname"] ?? base.tunnel.hostname,
    },
  };
}
