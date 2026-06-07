// src/commands.ts
import type { SessionStore } from "./session-store.js";

export interface CommandResult {
  reply?: string;
  abort?: boolean;
}

export function isCommand(text: string): boolean {
  return text.trim().startsWith("/");
}

const HELP = [
  "Commands:",
  "/new - start a fresh session",
  "/resume [id] - resume the latest (or a given) session",
  "/sessions - list recent sessions",
  "/stop - abort the current turn",
  "/help - this list",
].join("\n");

// Pure-ish command dispatch. Mutates the session store for /new and /resume;
// signals abort for /stop. Returns text to send back to the user.
export function handleCommand(
  text: string,
  deps: { store: SessionStore },
): CommandResult {
  const [cmd, ...args] = text.trim().slice(1).split(/\s+/);
  switch (cmd) {
    case "new":
      deps.store.clearCurrent();
      return { reply: "Started a new session." };
    case "resume": {
      const id = deps.store.resume(args[0]);
      return {
        reply: id
          ? `Resumed session ${id}.`
          : args[0]
            ? `No session ${args[0]} found.`
            : "No previous session to resume.",
      };
    }
    case "sessions": {
      const recent = deps.store.listRecent(5);
      return {
        reply: recent.length
          ? recent.map((r, i) => `${i}: ${r.id}`).join("\n")
          : "No sessions yet.",
      };
    }
    case "stop":
      return { reply: "Stopping current turn.", abort: true };
    case "help":
      return { reply: HELP };
    default:
      return { reply: `Unknown command /${cmd}. Try /help.` };
  }
}
