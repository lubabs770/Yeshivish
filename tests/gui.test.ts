import { describe, it, expect } from "vitest";
import { renderConfigForm, formBodyToConfig } from "../src/gui.js";

const cfg = {
  groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" },
  agent: { workspace_dir: "/ws", model: "m", max_turns: 30, auto_allow_read_tools: true },
  server: { port: 8787 },
  tunnel: { mode: "named", hostname: "h" },
  ingest: { mode: "webhook" },
  poll: { idle_ms: 10000, active_ms: 1000, decay_ms: 15000 },
} as any;

describe("renderConfigForm", () => {
  it("renders an HTML form pre-filled with current values", () => {
    const html = renderConfigForm(cfg);
    expect(html).toContain("<form");
    expect(html).toContain('value="B"'); // bot_id
    expect(html).toContain('name="groupme.bot_id"');
  });

  it("renders the ingest mode select and poll interval fields", () => {
    const html = renderConfigForm(cfg);
    expect(html).toContain('name="ingest.mode"');
    expect(html).toContain('name="poll.idle_ms"');
    expect(html).toContain('value="1000"'); // poll.active_ms
  });
});

describe("formBodyToConfig", () => {
  it("maps dotted form fields back into the config, coercing types", () => {
    const next = formBodyToConfig(
      {
        "groupme.access_token": "T2",
        "groupme.bot_id": "B2",
        "groupme.group_id": "G",
        "groupme.allowed_sender_id": "U",
        "agent.workspace_dir": "/ws2",
        "agent.model": "m",
        "agent.max_turns": "40",
        "agent.auto_allow_read_tools": "on",
        "server.port": "9000",
        "tunnel.mode": "quick",
        "tunnel.hostname": "",
      },
      cfg,
    );
    expect(next.groupme.bot_id).toBe("B2");
    expect(next.agent.max_turns).toBe(40);
    expect(next.agent.auto_allow_read_tools).toBe(true);
    expect(next.server.port).toBe(9000);
    expect(next.tunnel.mode).toBe("quick");
  });

  it("maps ingest mode and poll intervals, coercing intervals to numbers", () => {
    const next = formBodyToConfig(
      {
        "ingest.mode": "poll",
        "poll.idle_ms": "5000",
        "poll.active_ms": "500",
        "poll.decay_ms": "8000",
      } as any,
      cfg,
    );
    expect(next.ingest.mode).toBe("poll");
    expect(next.poll).toEqual({ idle_ms: 5000, active_ms: 500, decay_ms: 8000 });
  });

  it("treats a missing checkbox as false", () => {
    const next = formBodyToConfig(
      { "agent.auto_allow_read_tools": "" } as any,
      cfg,
    );
    expect(next.agent.auto_allow_read_tools).toBe(false);
  });
});
