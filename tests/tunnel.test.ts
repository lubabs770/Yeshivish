import { describe, it, expect, vi } from "vitest";
import { startTunnel } from "../src/tunnel.js";

const base = { server: { port: 8787 } } as any;

describe("startTunnel", () => {
  it("runs a named tunnel by hostname", () => {
    const spawnFn = vi.fn().mockReturnValue({ pid: 1 });
    const cfg = { ...base, tunnel: { mode: "named", hostname: "h.example.com" } };
    startTunnel(cfg, spawnFn);
    expect(spawnFn).toHaveBeenCalledOnce();
    const args = spawnFn.mock.calls[0][1] as string[];
    expect(args).toContain("run");
    expect(args).toContain("h.example.com");
  });

  it("runs a quick tunnel to the local port", () => {
    const spawnFn = vi.fn().mockReturnValue({ pid: 2 });
    const cfg = { ...base, tunnel: { mode: "quick", hostname: "" } };
    startTunnel(cfg, spawnFn);
    const args = spawnFn.mock.calls[0][1] as string[];
    expect(args.join(" ")).toContain("http://localhost:8787");
  });

  it("returns null and does not spawn when a named tunnel lacks a hostname", () => {
    const spawnFn = vi.fn();
    const cfg = { ...base, tunnel: { mode: "named", hostname: "" } };
    expect(startTunnel(cfg, spawnFn)).toBeNull();
    expect(spawnFn).not.toHaveBeenCalled();
  });
});
