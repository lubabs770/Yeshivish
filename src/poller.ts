// src/poller.ts
import type { Config, GroupMeCallback } from "./types.js";

const INDEX_URL = (groupId: string) =>
  `https://api.groupme.com/v3/groups/${groupId}/messages`;

// A single message as returned by the GroupMe read API. Mirrors the webhook
// callback shape closely enough to map field-for-field.
interface ReadMessage {
  id: string;
  text: string | null;
  name: string;
  sender_id: string;
  sender_type: GroupMeCallback["sender_type"];
  group_id: string;
  created_at: number;
  attachments: unknown[];
}

const LIMIT = 20;

export interface PollerDeps {
  cfg: Config;
  onCallback: (payload: GroupMeCallback) => void;
  fetchFn?: typeof fetch;
  // When a confirmation is awaiting a YES/NO, keep polling fast so it lands soon.
  broker?: { hasPending(): boolean };
}

export interface Poller {
  pollOnce(): Promise<number>;
  start(): void;
  stop(): void;
}

export function createPoller(deps: PollerDeps): Poller {
  const { cfg, onCallback } = deps;
  const fetchFn = deps.fetchFn ?? fetch;
  const hasPending = deps.broker?.hasPending.bind(deps.broker) ?? (() => false);

  let cursor: string | null = null;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityAt = 0;

  async function pollOnce(): Promise<number> {
    const url = new URL(INDEX_URL(cfg.groupme.group_id));
    url.searchParams.set("token", cfg.groupme.access_token);
    url.searchParams.set("limit", "20");
    if (cursor) url.searchParams.set("after_id", cursor);

    let messages: ReadMessage[];
    try {
      const res = await fetchFn(url.toString());
      // GroupMe returns 304 with an empty body when after_id has nothing newer.
      if (res.status === 304) return 0;
      const body = (await res.json()) as { response?: { messages?: ReadMessage[] } };
      messages = body.response?.messages ?? [];
    } catch (err) {
      // Never let a transient failure kill the polling loop; retry next tick.
      console.error("poll failed:", (err as Error).message);
      return 0;
    }

    // First poll just establishes where "now" is; never replay backlog.
    if (cursor === null) {
      if (messages.length) cursor = newestId(messages);
      return 0;
    }

    if (!messages.length) return 0;

    // Dispatch oldest-first so replies keep the user's order; sort by numeric id
    // (BigInt) rather than string compare, which breaks across id lengths.
    const ordered = [...messages].sort((a, b) =>
      a.id === b.id ? 0 : byIdAsc(a.id, b.id),
    );
    for (const m of ordered) {
      onCallback({
        id: m.id,
        text: m.text,
        name: m.name,
        sender_id: m.sender_id,
        sender_type: m.sender_type,
        group_id: m.group_id,
        created_at: m.created_at,
        attachments: m.attachments,
      });
    }
    cursor = newestId(ordered);
    return ordered.length;
  }

  // Fast while we recently saw traffic or are waiting on a YES/NO; idle otherwise.
  function nextInterval(): number {
    const recent = Date.now() - lastActivityAt < cfg.poll.decay_ms;
    return recent || hasPending() ? cfg.poll.active_ms : cfg.poll.idle_ms;
  }

  async function tick(): Promise<void> {
    if (!running) return;
    let dispatched = await pollOnce();
    if (dispatched > 0) lastActivityAt = Date.now();
    // A full page means more may be waiting; drain the burst before sleeping.
    while (running && dispatched >= LIMIT) {
      dispatched = await pollOnce();
      if (dispatched > 0) lastActivityAt = Date.now();
    }
    if (!running) return;
    timer = setTimeout(tick, nextInterval());
  }

  function start(): void {
    if (running) return;
    running = true;
    void tick();
  }

  function stop(): void {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { pollOnce, start, stop };
}

// Numeric-ascending comparison of GroupMe ids (large numeric strings).
function byIdAsc(a: string, b: string): number {
  return BigInt(a) < BigInt(b) ? -1 : 1;
}

// Highest id by numeric value (the newest message).
function newestId(messages: ReadMessage[]): string {
  return messages.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), messages[0].id);
}
