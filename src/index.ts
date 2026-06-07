// src/index.ts
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, saveConfig as writeConfig, validateConfig } from "./config.js";
import type { Config, GroupMeCallback } from "./types.js";
import { SessionStore } from "./session-store.js";
import { createSender } from "./groupme.js";
import { PermissionBroker } from "./permission-broker.js";
import { decide } from "./gateway.js";
import { handleCommand } from "./commands.js";
import { runTurn, type QueryFn } from "./agent.js";
import { TurnQueue } from "./turn-queue.js";
import { bootstrapWorkspace } from "./sms-rules.js";
import { createServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

const CONFIG_PATH = join(process.cwd(), "config.yaml");
const EXAMPLE_PATH = join(process.cwd(), "config.example.yaml");
const STATE_PATH = join(process.cwd(), "state.json");

// First run: seed config.yaml from the committed template so the server can
// boot and the user can fill in the blanks via the GUI instead of hitting a
// crash before anything starts.
if (!existsSync(CONFIG_PATH)) {
  copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
  console.log(`No config.yaml found; created one from the template at ${CONFIG_PATH}.`);
}

let config: Config = loadConfig(CONFIG_PATH);
const problems = validateConfig(config);
if (problems.length) {
  console.warn("Config incomplete; open the GUI to fill it in:\n  " + problems.join("\n  "));
}

bootstrapWorkspace(config.agent.workspace_dir);

const store = new SessionStore(STATE_PATH);
const sender = createSender(config, fetch, { retries: 2, delayMs: 250 });
const broker = new PermissionBroker({
  send: (t) => sender.send(t),
  autoAllowReadTools: config.agent.auto_allow_read_tools,
});
const queue = new TurnQueue();
const seen = new Set<string>();

function onCallback(payload: GroupMeCallback): void {
  const decision = decide(payload, { cfg: config, seen, hasPending: () => broker.hasPending() });
  switch (decision.kind) {
    case "ignore":
      return;
    case "confirm":
      broker.resolvePending(decision.allowed);
      return;
    case "command": {
      const res = handleCommand(decision.text, { store });
      if (res.abort) queue.abortCurrent();
      if (res.reply) void sender.send(res.reply);
      return;
    }
    case "prompt":
      // Note: hasPending() is only true once a queued turn reaches a risky
      // canUseTool call. A "yes"/"no" texted before that window is routed here
      // as a prompt and queued behind the running turn; it can't double-approve
      // because the broker denies a second concurrent confirmation request.
      queue.enqueue(async (signal) => {
        try {
          const { text } = await runTurn(decision.text, {
            cfg: config,
            store,
            broker,
            queryFn: query as unknown as QueryFn,
            signal,
          });
          await sender.send(text || "(no output)");
        } catch (err) {
          await sender.send(`Error: ${(err as Error).message}`);
        }
      });
      return;
  }
}

const server = createServer({
  getConfig: () => config,
  saveConfig: (next) => {
    writeConfig(CONFIG_PATH, next);
    config = loadConfig(CONFIG_PATH);
  },
  onCallback,
});

// Bind to loopback only. cloudflared connects from localhost, so the public
// callback still works through the tunnel, but the port is not exposed on the
// LAN directly (the GUI's secrets stay behind both the bind and the IP guard).
server.listen(config.server.port, "127.0.0.1", () => {
  console.log(`yeshivish listening on http://localhost:${config.server.port}`);
  console.log(`Config GUI: http://localhost:${config.server.port}/`);
});

const tunnel = startTunnel(config);
if (tunnel) console.log(`cloudflared started (pid ${tunnel.pid}).`);
else console.log("No tunnel started; run cloudflared manually (see README).");
