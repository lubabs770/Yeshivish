import { describe, it, expect, vi } from "vitest";
import { PermissionBroker } from "../src/permission-broker.js";

function makeBroker(autoAllow = true) {
  const sent: string[] = [];
  const broker = new PermissionBroker({
    send: async (t) => { sent.push(t); },
    autoAllowReadTools: autoAllow,
    timeoutMs: 50,
  });
  return { broker, sent };
}

describe("PermissionBroker", () => {
  it("auto-allows read tools without sending anything", async () => {
    const { broker, sent } = makeBroker();
    const res = await broker.canUseTool("Read", { file_path: "/x" }, {});
    expect(res).toEqual({ behavior: "allow" });
    expect(sent).toEqual([]);
    expect(broker.hasPending()).toBe(false);
  });

  it("posts a confirmation for Bash and allows on YES", async () => {
    const { broker, sent } = makeBroker();
    const p = broker.canUseTool("Bash", { command: "ls" }, {});
    // allow the microtask that posts the confirmation to run
    await Promise.resolve();
    expect(sent[0]).toMatch(/Bash: ls/);
    expect(broker.hasPending()).toBe(true);
    broker.resolvePending(true);
    expect(await p).toEqual({ behavior: "allow" });
    expect(broker.hasPending()).toBe(false);
  });

  it("denies on NO", async () => {
    const { broker } = makeBroker();
    const p = broker.canUseTool("Write", { file_path: "/x" }, {});
    await Promise.resolve();
    broker.resolvePending(false);
    const res = await p;
    expect(res.behavior).toBe("deny");
  });

  it("denies on timeout", async () => {
    const { broker } = makeBroker();
    const res = await broker.canUseTool("Bash", { command: "ls" }, {});
    expect(res.behavior).toBe("deny");
  });

  it("resolvePending returns false when nothing is pending", () => {
    const { broker } = makeBroker();
    expect(broker.resolvePending(true)).toBe(false);
  });
});
