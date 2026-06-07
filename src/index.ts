// src/index.ts
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
const STATE_PATH = join(process.cwd(), "state.json");

let config: Config = loadConfig(CONFIG_PATH);
const problems = validateConfig(config);
if (problems.length) {
  console.warn("Config incomplete; open the GUI to fix:\n  " + problems.join("\n  "));
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

server.listen(config.server.port, () => {
  console.log(`yeshivish listening on http://localhost:${config.server.port}`);
  console.log(`Config GUI: http://localhost:${config.server.port}/`);
});

const tunnel = startTunnel(config);
if (tunnel) console.log(`cloudflared started (pid ${tunnel.pid}).`);
else console.log("No tunnel started; run cloudflared manually (see README).");
