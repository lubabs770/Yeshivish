import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";

const cfg = {
  server: { port: 0 },
  groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" },
  agent: { workspace_dir: "/ws", model: "m", max_turns: 5, auto_allow_read_tools: true },
  tunnel: { mode: "named", hostname: "h" },
} as any;

let server: any;
afterEach(() => server?.close());

async function listen(deps: any) {
  server = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("createServer", () => {
  it("invokes onCallback for POST /groupme/callback", async () => {
    const onCallback = vi.fn();
    const base = await listen({ getConfig: () => cfg, saveConfig: vi.fn(), onCallback });
    await fetch(`${base}/groupme/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", text: "hi", sender_id: "U", sender_type: "user" }),
    });
    expect(onCallback).toHaveBeenCalledOnce();
    expect(onCallback.mock.calls[0][0].text).toBe("hi");
  });

  it("serves the config form on GET /", async () => {
    const base = await listen({ getConfig: () => cfg, saveConfig: vi.fn(), onCallback: vi.fn() });
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("<form");
  });

  it("saves config on POST /config", async () => {
    const saveConfig = vi.fn();
    const base = await listen({ getConfig: () => cfg, saveConfig, onCallback: vi.fn() });
    await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "groupme.bot_id=NEW&agent.max_turns=10&server.port=8787&tunnel.mode=named",
    });
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(saveConfig.mock.calls[0][0].groupme.bot_id).toBe("NEW");
  });
});
