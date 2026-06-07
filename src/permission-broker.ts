// src/permission-broker.ts
import type { PermissionResult } from "./types.js";
import { classifyTool, describeTool } from "./risk.js";

interface Pending {
  resolve: (allowed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

// Implements the Agent SDK canUseTool callback. Safe tools resolve immediately;
// risky tools post a YES/NO confirmation over GroupMe and block until the
// gateway calls resolvePending (or a timeout denies the call).
export class PermissionBroker {
  private pending: Pending | null = null;

  constructor(
    private deps: {
      send: (text: string) => Promise<void>;
      autoAllowReadTools: boolean;
      timeoutMs?: number;
    },
  ) {}

  hasPending(): boolean {
    return this.pending !== null;
  }

  // Called by the gateway when an authorized YES/NO reply arrives. Returns
  // true if a request was waiting.
  resolvePending(allowed: boolean): boolean {
    if (!this.pending) return false;
    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    resolve(allowed);
    return true;
  }

  async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    _opts: unknown,
  ): Promise<PermissionResult> {
    if (classifyTool(toolName, this.deps.autoAllowReadTools) === "allow") {
      return { behavior: "allow" };
    }

    // Confirmations are handled one at a time; a single SMS YES/NO can't
    // disambiguate multiple concurrent requests, so deny immediately if one
    // is already in flight.
    if (this.pending) {
      return {
        behavior: "deny",
        message:
          "Another confirmation is already pending; please answer it first.",
      };
    }

    const allowed = await this.ask(describeTool(toolName, input));
    return allowed
      ? { behavior: "allow" }
      : { behavior: "deny", message: "Denied by SMS (no confirmation)." };
  }

  private ask(summary: string): Promise<boolean> {
    const timeoutMs = this.deps.timeoutMs ?? 5 * 60 * 1000;
    this.deps.send(
      `⚠️ Claude wants to run ${summary} — reply YES to allow, NO to deny.`,
    ).catch((err: unknown) => {
      console.error("Failed to send confirmation prompt:", err);
    });
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        resolve(false);
      }, timeoutMs);
      this.pending = { resolve, timer };
    });
  }
}
