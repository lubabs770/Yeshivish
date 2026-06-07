// src/agent.ts
import type { Config } from "./types.js";
import type { SessionStore } from "./session-store.js";
import type { PermissionBroker } from "./permission-broker.js";
import { SMS_RULES } from "./sms-rules.js";

export interface TurnResult {
  text: string;
  sessionId: string | null;
}

// Minimal shape of the SDK query function so we can inject a fake in tests.
export type QueryFn = (args: {
  prompt: string;
  options: Record<string, unknown>;
}) => AsyncIterable<any>;

// Run a single agent turn: build options (resuming the stored session if any),
// stream messages, accumulate assistant text, and persist the new session id.
export async function runTurn(
  prompt: string,
  deps: {
    cfg: Config;
    store: SessionStore;
    broker: PermissionBroker;
    queryFn: QueryFn;
    signal?: AbortSignal;
  },
): Promise<TurnResult> {
  const { cfg, store, broker, queryFn } = deps;
  const resume = store.currentSessionId() ?? undefined;

  // Build an AbortController from the signal if provided.
  // The SDK Options type expects `abortController?: AbortController` (a real
  // AbortController instance), NOT `{ signal }`. We create one and wire the
  // caller's signal to abort it.
  let abortController: AbortController | undefined;
  if (deps.signal) {
    abortController = new AbortController();
    deps.signal.addEventListener("abort", () => abortController!.abort(), {
      once: true,
    });
  }

  const options: Record<string, unknown> = {
    cwd: cfg.agent.workspace_dir,
    model: cfg.agent.model,
    maxTurns: cfg.agent.max_turns,
    permissionMode: "default",
    allowedTools: ["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"],
    canUseTool: broker.canUseTool.bind(broker),
    systemPrompt: { type: "preset", preset: "claude_code", append: SMS_RULES },
    abortController,
  };
  if (resume) options.resume = resume;

  let text = "";
  let sessionId: string | null = null;

  for await (const msg of queryFn({ prompt, options })) {
    if (msg.session_id) sessionId = msg.session_id;
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "text") text += block.text;
      }
    }
  }

  if (sessionId) {
    store.setCurrent(sessionId);
    store.recordCompleted(sessionId);
  }
  return { text: text.trim(), sessionId };
}
