// src/session-store.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface State {
  currentSessionId: string | null;
  recent: { id: string; ts: number }[];
}

const EMPTY: State = { currentSessionId: null, recent: [] };

// Persists the active session id and a newest-first list of past session ids
// to a JSON file. Backs /new (clearCurrent), /resume, and /sessions.
export class SessionStore {
  private state: State;
  constructor(private path: string) {
    this.state =
      existsSync(path)
        ? (JSON.parse(readFileSync(path, "utf8")) as State)
        : { ...EMPTY };
  }

  private save(): void {
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  currentSessionId(): string | null {
    return this.state.currentSessionId;
  }

  setCurrent(id: string): void {
    this.state.currentSessionId = id;
    this.save();
  }

  clearCurrent(): void {
    this.state.currentSessionId = null;
    this.save();
  }

  recordCompleted(id: string): void {
    this.state.recent = [
      { id, ts: Date.now() },
      ...this.state.recent.filter((r) => r.id !== id),
    ];
    this.save();
  }

  listRecent(n: number): { id: string; ts: number }[] {
    return this.state.recent.slice(0, n);
  }

  // Resume the most recent session (no ref) or a specific id. Returns the
  // resumed id (and sets it current), or null if not found.
  resume(ref?: string): string | null {
    const target = ref
      ? this.state.recent.find((r) => r.id === ref)?.id ?? null
      : this.state.recent[0]?.id ?? null;
    if (target) this.setCurrent(target);
    return target;
  }
}
