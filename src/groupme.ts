// src/groupme.ts
import type { Config } from "./types.js";
import { chunkText } from "./chunk.js";

const POST_URL = "https://api.groupme.com/v3/bots/post";

export interface Sender {
  send(text: string): Promise<void>;
}

// Posts a (possibly chunked) reply to the GroupMe group as the bot. Each chunk
// is retried up to `retries` times with a short backoff before giving up.
export function createSender(
  cfg: Config,
  fetchFn: typeof fetch = fetch,
  opts: { retries?: number; delayMs?: number } = {},
): Sender {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 0;

  async function postChunk(text: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchFn(POST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bot_id: cfg.groupme.bot_id, text }),
      });
      if (res.ok) return;
      if (attempt >= retries) {
        throw new Error(`bots/post failed: ${res.status}`);
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return {
    async send(text: string): Promise<void> {
      for (const chunk of chunkText(text)) {
        await postChunk(chunk);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      }
    },
  };
}
