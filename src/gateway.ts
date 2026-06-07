// src/gateway.ts
import type { Config, GroupMeCallback, Decision } from "./types.js";
import { isCommand } from "./commands.js";

// Cap on remembered message ids for dedupe. The process is long-running, so the
// `seen` set is pruned (oldest-first; Sets keep insertion order) to bound memory.
const SEEN_LIMIT = 1000;

// Decide what to do with an incoming GroupMe callback. Order matters:
// authorization and loop-prevention first, then dedupe, then routing.
export function decide(
  payload: GroupMeCallback,
  deps: { cfg: Config; seen: Set<string>; hasPending: () => boolean },
): Decision {
  if (payload.sender_type === "bot") return { kind: "ignore" };
  if (payload.sender_id !== deps.cfg.groupme.allowed_sender_id) {
    return { kind: "ignore" };
  }
  if (deps.seen.has(payload.id)) return { kind: "ignore" };
  deps.seen.add(payload.id);
  if (deps.seen.size > SEEN_LIMIT) {
    deps.seen.delete(deps.seen.values().next().value as string);
  }

  const text = (payload.text ?? "").trim();
  if (!text) return { kind: "ignore" };

  if (deps.hasPending()) {
    const lower = text.toLowerCase();
    if (lower === "yes" || lower === "y") return { kind: "confirm", allowed: true };
    if (lower === "no" || lower === "n") return { kind: "confirm", allowed: false };
    // fall through: treat non-yes/no as a normal message
  }

  if (isCommand(text)) return { kind: "command", text };
  return { kind: "prompt", text };
}
