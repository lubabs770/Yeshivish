// src/server.ts
import http from "node:http";
import type { Config, GroupMeCallback } from "./types.js";
import { renderConfigForm, formBodyToConfig } from "./gui.js";

export interface ServerDeps {
  getConfig: () => Config;
  saveConfig: (cfg: Config) => void;
  onCallback: (payload: GroupMeCallback) => void;
}

// True only for loopback peers. The GUI/config routes carry secrets, so they
// are restricted to this set even though the listener may bind more broadly.
export function isLocalAddress(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function isLocal(req: http.IncomingMessage): boolean {
  return isLocalAddress(req.socket.remoteAddress ?? "");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export function createServer(deps: ServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/groupme/callback") {
      const payload = JSON.parse((await readBody(req)) || "{}") as GroupMeCallback;
      deps.onCallback(payload);
      res.writeHead(200).end("ok");
      return;
    }

    // GUI routes are localhost-only.
    if (url.pathname === "/" || url.pathname === "/config") {
      if (!isLocal(req)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(renderConfigForm(deps.getConfig()));
        return;
      }
      if (req.method === "POST" && url.pathname === "/config") {
        const body = Object.fromEntries(
          new URLSearchParams(await readBody(req)),
        ) as Record<string, string>;
        deps.saveConfig(formBodyToConfig(body, deps.getConfig()));
        res.writeHead(303, { Location: "/" }).end();
        return;
      }
    }

    res.writeHead(404).end("not found");
  });
}
