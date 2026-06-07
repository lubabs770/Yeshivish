import { describe, it, expect } from "vitest";
import { renderConfigForm, formBodyToConfig } from "../src/gui.js";

const cfg = {
  groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" },
  agent: { workspace_dir: "/ws", model: "m", max_turns: 30, auto_allow_read_tools: true },
  server: { port: 8787 },
  tunnel: { mode: "named", hostname: "h" },
} as any;

describe("renderConfigForm", () => {
  it("renders an HTML form pre-filled with current values", () => {
    const html = renderConfigForm(cfg);
    expect(html).toContain("<form");
    expect(html).toContain('value="B"'); // bot_id
    expect(html).toContain('name="groupme.bot_id"');
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

  it("treats a missing checkbox as false", () => {
    const next = formBodyToConfig(
      { "agent.auto_allow_read_tools": "" } as any,
      cfg,
    );
    expect(next.agent.auto_allow_read_tools).toBe(false);
  });
});
