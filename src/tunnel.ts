// src/tunnel.ts
import { spawn, type ChildProcess } from "node:child_process";
import type { Config } from "./types.js";

type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

// Start cloudflared for the configured tunnel. Named mode runs a pre-created
// tunnel by hostname (stable URL); quick mode opens an ephemeral tunnel to the
// local port. Returns null (no spawn) if a named tunnel has no hostname.
export function startTunnel(
  cfg: Config,
  spawnFn: SpawnFn = spawn,
): ChildProcess | null {
  let args: string[];
  if (cfg.tunnel.mode === "named") {
    if (!cfg.tunnel.hostname) return null;
    args = ["tunnel", "run", cfg.tunnel.hostname];
  } else {
    args = ["tunnel", "--url", `http://localhost:${cfg.server.port}`];
  }
  return spawnFn("cloudflared", args, { stdio: "inherit" });
}
