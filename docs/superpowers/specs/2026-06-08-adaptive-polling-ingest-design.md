# Adaptive polling ingest for Yeshivish

**Date:** 2026-06-08
**Status:** Approved, ready for implementation

## Goal

Let Yeshivish receive GroupMe messages by **polling the read API** instead of
receiving webhook callbacks through a cloudflared tunnel. This removes the
requirement to expose the local server to the public internet (no Cloudflare /
ngrok / tunnel of any kind). The webhook path stays available behind a config
toggle.

## Key insight

The poller does not touch the routing brain. `decide()` and `onCallback()`
already accept a `GroupMeCallback` and handle authorization, bot-loop
prevention, and dedupe (the `seen` Set). The poller only needs to:

```
GroupMe read API  →  pollOnce()  →  map msg → GroupMeCallback  →  onCallback()
```

Overlapping re-fetches are harmless because `seen` dedupes by message id.
Webhook and poll are two interchangeable ingest front-ends feeding one pipeline.

## New module: `src/poller.ts`

`createPoller(deps)` where `deps` is:

- `cfg: Config`
- `onCallback: (payload: GroupMeCallback) => void`
- `fetchFn?: typeof fetch` (injectable for tests, defaults to global `fetch`)
- `broker: { hasPending(): boolean }` (to stay in fast mode during a YES/NO)
- optional injected `now()` / timer fns for deterministic scheduling tests

Returns `{ start(): void; stop(): void; pollOnce(): Promise<number> }`.

### `pollOnce()` — the testable core

1. Build URL: `GET https://api.groupme.com/v3/groups/<group_id>/messages?token=<access_token>&limit=20`, plus `&after_id=<cursor>` once a cursor exists.
2. **First poll = baseline only.** No cursor yet: fetch most-recent, set the
   cursor to `messages[0].id`, dispatch nothing (no backlog replay on startup —
   matches webhook semantics across restarts).
3. **HTTP 304** (GroupMe returns this when `after_id` has nothing newer): treat
   as "no new messages", do not parse the body, leave cursor unchanged, return 0.
4. On 200: messages come newest-first; reverse to chronological order, map each
   to a `GroupMeCallback`, call `onCallback` for each, then advance the cursor to
   the newest id processed.
5. Return the number of messages dispatched.

Cursor uses GroupMe's `after_id` param — **not** string comparison of ids
(`m.id > lastId` is lexicographic and breaks across digit-length boundaries).

If a poll returns a full page (count === 20), `start()`'s scheduler polls again
immediately to drain a burst rather than waiting out the interval.

### Message → `GroupMeCallback` mapping

GroupMe read-API message fields map directly:
`id, text, name, sender_id, sender_type, group_id, created_at, attachments`.

### Adaptive scheduling (the "creepy" part)

`start()` runs a self-rescheduling timer. After each `pollOnce()`:

```
sinceActivity = now() - lastActivityAt          // updated when dispatched > 0
fast = sinceActivity < poll.decay_ms || broker.hasPending()
interval = fast ? poll.active_ms : poll.idle_ms
```

Defaults: `active_ms = 1000`, `idle_ms = 10000`, `decay_ms = 15000`.
`broker.hasPending()` keeps polling at 1s while an approval is outstanding so
YES/NO lands within ~1s.

### Error handling (critical)

The entire fetch + dispatch in the scheduler tick is wrapped so a thrown error
(network blip, bad JSON) is logged and **the loop always reschedules**. The
reference sketch dies permanently if `poll()` ever throws because
`scheduleNext()` is never reached. The cursor is only advanced on a successful
200 dispatch, so a failed poll is retried cleanly next tick.

## Config changes

`types.ts` (and `config.example.yaml`):

```yaml
ingest:
  mode: "webhook"   # webhook | poll
poll:
  idle_ms: 10000    # interval when quiet
  active_ms: 1000   # interval right after activity / while a YES/NO is pending
  decay_ms: 15000   # return to idle after this much silence
```

- `mode` defaults to `webhook` so existing behavior is unchanged.
- `loadConfig` fills `ingest` and `poll` with defaults when absent so existing
  `config.yaml` files keep working without edits.
- `validateConfig` unchanged: poll mode reuses already-required `access_token`
  and `group_id`; no new required fields.

`gui.ts`: new "Ingest" fieldset — a `ingest.mode` select plus three number
inputs (`poll.idle_ms`, `poll.active_ms`, `poll.decay_ms`), round-tripped
through `formBodyToConfig` (coerce the three to numbers).

`index.ts`: branch on `config.ingest.mode`:
- `webhook` → start tunnel (current behavior).
- `poll` → create and `start()` the poller, do **not** start the tunnel.
The HTTP server still runs in both modes for the localhost-only config GUI; the
`/groupme/callback` route is left in place but dormant in poll mode.

## Testing

Mirror `tests/groupme.test.ts` (inject `fetchFn`):

- `tests/poller.test.ts`:
  - first poll establishes the baseline cursor and dispatches nothing
  - a subsequent poll maps a message to `GroupMeCallback` and calls `onCallback`
  - the request URL carries `after_id` once a cursor is set
  - cursor advances to the newest dispatched id
  - HTTP 304 → no dispatch, no throw, cursor unchanged
  - a rejected `fetchFn` is swallowed (no throw); with fake timers the loop
    still reschedules
- `tests/config.test.ts`: a config lacking `ingest`/`poll` loads with defaults
- `tests/gui.test.ts`: the new fields round-trip through `formBodyToConfig`

The `index.ts` startup branch (tunnel only in webhook mode) is a thin script
wiring and is verified manually rather than unit-tested, consistent with the
current code.

## Out of scope (YAGNI)

- Persisting the cursor across restarts (baseline-to-latest on boot is fine).
- A `TurnQueue` busy flag (the 15s activity decay already covers a turn).
- Long-polling / websockets (GroupMe push). Simple interval polling is enough.
