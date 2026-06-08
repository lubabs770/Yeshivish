// src/gui.ts
import type { Config } from "./types.js";

function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

interface FieldOpts {
  label: string;
  hint?: string;
  type?: string;
}

// One labeled input row. The dotted `name` and `value="..."` attributes are
// kept verbatim so saved form bodies map straight back through formBodyToConfig.
function field(name: string, value: unknown, opts: FieldOpts): string {
  const type = opts.type ?? "text";
  const hint = opts.hint ? `<span class="hint">${opts.hint}</span>` : "";
  return `<label class="field">
  <span class="field-label">${opts.label}<code>${name}</code></span>
  <input type="${type}" name="${name}" value="${esc(value)}" spellcheck="false" autocomplete="off">
  ${hint}
</label>`;
}

const STYLE = `
:root{
  --bg:#0f1115; --panel:#171a21; --panel-2:#1d212b; --border:#2a2f3a;
  --text:#e6e8ee; --muted:#8b93a7; --accent:#7c8cff; --accent-2:#5d6cff;
  --ok:#3fb950; --code:#a8b1ff;
}
*{box-sizing:border-box}
body{
  margin:0; min-height:100vh; color:var(--text);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  background:radial-gradient(1200px 600px at 70% -10%,#1b2030 0,var(--bg) 55%);
  padding:3rem 1rem;
}
.wrap{max-width:42rem;margin:0 auto}
.brand{display:flex;align-items:baseline;gap:.6rem;margin-bottom:.25rem}
.brand h1{font-size:1.6rem;margin:0;letter-spacing:-.02em}
.brand .tag{color:var(--muted);font-size:.85rem}
.lede{color:var(--muted);margin:0 0 2rem}
form{display:flex;flex-direction:column;gap:1.25rem}
fieldset{
  border:1px solid var(--border);border-radius:14px;margin:0;padding:1.25rem 1.25rem 1.4rem;
  background:linear-gradient(180deg,var(--panel),var(--panel-2));
}
legend{
  padding:0 .5rem;margin-left:-.25rem;font-weight:600;font-size:.78rem;
  letter-spacing:.08em;text-transform:uppercase;color:var(--accent);
}
.field{display:block;margin-top:1rem}
.field:first-of-type{margin-top:.25rem}
.field-label{display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem;font-weight:500}
.field-label code,.hint code{
  font:12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--code);
  background:#0d0f14;border:1px solid var(--border);border-radius:6px;padding:.2rem .4rem;
}
input,select{
  width:100%;padding:.6rem .7rem;color:var(--text);
  background:#0d0f14;border:1px solid var(--border);border-radius:9px;
  font:inherit;transition:border-color .15s,box-shadow .15s;
}
input:focus,select:focus{
  outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(124,140,255,.18);
}
.hint{display:block;margin-top:.35rem;color:var(--muted);font-size:.82rem}
.toggle{display:flex;align-items:center;gap:.7rem;margin-top:1rem;cursor:pointer}
.toggle input{width:auto;accent-color:var(--accent);width:1.1rem;height:1.1rem}
.toggle .t-text{font-weight:500}
.toggle .hint{margin-top:0}
button{
  align-self:flex-start;margin-top:.25rem;padding:.7rem 1.4rem;
  color:#fff;font:inherit;font-weight:600;cursor:pointer;
  background:linear-gradient(180deg,var(--accent),var(--accent-2));
  border:0;border-radius:10px;box-shadow:0 6px 18px rgba(93,108,255,.35);
  transition:transform .06s,box-shadow .15s,filter .15s;
}
button:hover{filter:brightness(1.06)}
button:active{transform:translateY(1px)}
footer{margin-top:1.5rem;color:var(--muted);font-size:.8rem;text-align:center}
@media (prefers-color-scheme:light){
  :root{--bg:#f4f5f8;--panel:#fff;--panel-2:#fafbff;--border:#e1e4ec;
    --text:#1a1d26;--muted:#5f6678;--code:#4250d0;}
  body{background:radial-gradient(1200px 600px at 70% -10%,#eef0fb 0,var(--bg) 55%)}
  input,select,.field-label code,.hint code{background:#f6f7fb}
}
`;

// Renders the config form, pre-filled from the current config and grouped by
// section. Field name/value attributes match what formBodyToConfig expects.
export function renderConfigForm(cfg: Config): string {
  const checked = cfg.agent.auto_allow_read_tools ? "checked" : "";
  const modeOpt = (v: string, label: string) =>
    `<option value="${v}"${cfg.tunnel.mode === v ? " selected" : ""}>${label}</option>`;
  const ingestOpt = (v: string, label: string) =>
    `<option value="${v}"${cfg.ingest.mode === v ? " selected" : ""}>${label}</option>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>yeshivish config</title>
<style>${STYLE}</style></head>
<body><div class="wrap">
<div class="brand"><h1>yeshivish</h1><span class="tag">Claude Code over SMS</span></div>
<p class="lede">Configure the GroupMe bridge and agent. Saved to <code>config.yaml</code>; this page is reachable from localhost only.</p>
<form method="post" action="/config">

<fieldset>
<legend>GroupMe</legend>
${field("groupme.access_token", cfg.groupme.access_token, { label: "Access token", type: "password", hint: "Your GroupMe API token from dev.groupme.com." })}
${field("groupme.bot_id", cfg.groupme.bot_id, { label: "Bot ID", hint: "Returned when you register the bot (POST /bots)." })}
${field("groupme.group_id", cfg.groupme.group_id, { label: "Group ID", hint: "The group the bot posts in." })}
${field("groupme.allowed_sender_id", cfg.groupme.allowed_sender_id, { label: "Allowed sender ID", hint: "Only this GroupMe user can drive the agent." })}
</fieldset>

<fieldset>
<legend>Agent</legend>
${field("agent.workspace_dir", cfg.agent.workspace_dir, { label: "Workspace dir", hint: "The agent runs confined to this directory." })}
${field("agent.model", cfg.agent.model, { label: "Model" })}
${field("agent.max_turns", cfg.agent.max_turns, { label: "Max turns", type: "number" })}
<label class="toggle">
  <input type="checkbox" name="agent.auto_allow_read_tools" ${checked}>
  <span><span class="t-text">Auto-allow read-only tools</span><span class="hint">Reads run without asking; writes and Bash always need an SMS confirmation.</span></span>
</label>
</fieldset>

<fieldset>
<legend>Server</legend>
${field("server.port", cfg.server.port, { label: "Port", type: "number", hint: "Local callback + config GUI port." })}
</fieldset>

<fieldset>
<legend>Ingest</legend>
<label class="field">
  <span class="field-label">Mode<code>ingest.mode</code></span>
  <select name="ingest.mode">${ingestOpt("webhook", "Webhook (cloudflared tunnel)")}${ingestOpt("poll", "Poll (no public endpoint)")}</select>
  <span class="hint">Poll reads the GroupMe API on a timer; no tunnel needed. Webhook needs the tunnel below.</span>
</label>
${field("poll.idle_ms", cfg.poll.idle_ms, { label: "Idle interval (ms)", type: "number", hint: "Poll spacing while the chat is quiet." })}
${field("poll.active_ms", cfg.poll.active_ms, { label: "Active interval (ms)", type: "number", hint: "Faster spacing right after activity or while awaiting a YES/NO." })}
${field("poll.decay_ms", cfg.poll.decay_ms, { label: "Decay (ms)", type: "number", hint: "Return to the idle interval after this much silence." })}
</fieldset>

<fieldset>
<legend>Tunnel</legend>
<label class="field">
  <span class="field-label">Mode<code>tunnel.mode</code></span>
  <select name="tunnel.mode">${modeOpt("named", "Named (stable URL)")}${modeOpt("quick", "Quick (ephemeral)")}</select>
  <span class="hint">Named uses a pre-created cloudflared tunnel; quick opens a throwaway one.</span>
</label>
${field("tunnel.hostname", cfg.tunnel.hostname, { label: "Hostname", hint: "Public hostname for the named tunnel." })}
</fieldset>

<button type="submit">Save config</button>
</form>
<footer>Changes take effect on the next message.</footer>
</div></body></html>`;
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
    ingest: {
      mode: (body["ingest.mode"] as "webhook" | "poll") ?? base.ingest.mode,
    },
    poll: {
      idle_ms: Number(body["poll.idle_ms"] ?? base.poll.idle_ms),
      active_ms: Number(body["poll.active_ms"] ?? base.poll.active_ms),
      decay_ms: Number(body["poll.decay_ms"] ?? base.poll.decay_ms),
    },
  };
}
