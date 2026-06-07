# Design: Claude Code over SMS (via GroupMe)

**Date:** 2026-06-07
**Status:** Approved — ready for implementation plan

## Overview

A long-running Node/TypeScript app that lives on a PC and lets the user drive a
Claude Code agent session by text message. The user texts a GroupMe group (which
works over plain SMS); a GroupMe bot relays the message to a Claude Agent SDK
session running on the machine; the agent's reply is posted back to the group and
delivered to the phone as SMS. Risky actions (file writes, shell commands) are
gated behind an SMS confirmation the user must approve with a `YES` reply.

The repository is `lubabs770/Yeshivish` (personal account), cloned at
`/Users/sam/yeshivish`.

## Goals

- Text Claude Code from a phone over SMS and get useful, concise replies.
- The agent can do real work on the PC (read files, run commands, edit code).
- Anything destructive requires explicit SMS confirmation before it runs.
- Only the single authorized user can trigger the agent.
- Simple to configure via a YAML file and a local web form.

## Non-Goals

- Multi-user support beyond a single authorized `sender_id`.
- A polished chat UI — the interface is SMS/GroupMe text.
- Exposing anything other than the GroupMe callback to the public internet.
- Running multiple concurrent agent turns (one at a time, others queue).

## Key Decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| What "Claude" is | Agentic — Claude Code on the PC via the Agent SDK |
| Inbound bridge | Tunnel (cloudflared), **named** tunnel for a stable callback URL |
| Authorization | Single allowlisted GroupMe `sender_id` |
| Agent powers | Confined to a workspace dir + SMS confirmation for risky actions |
| Conversation state | One persistent session; `/new` resets, `/resume` resumes a prior session |
| Runtime/stack | Node 20+ / TypeScript + `@anthropic-ai/claude-agent-sdk` |
| Orchestration | Per-message `query()` with `resume: <sessionId>` (robust, restart-safe) |
| Risk gate | All `Bash` + all writes (`Write`/`Edit`/`NotebookEdit`) need `YES`; reads auto-approve |
| Config | `config.yaml` + a localhost-only HTML config form |
| Agent behavior | Built-in `CLAUDE.md` in the workspace instructing SMS-style replies |

## Architecture

Each component has one clear purpose and is independently testable.

### 1. Tunnel
`cloudflared` exposes the local server at a public HTTPS URL so GroupMe can reach
the callback. Use a **named tunnel** so the URL is stable across restarts — the
bot's `callback_url` is fixed at bot registration time and GroupMe has no
documented update endpoint, so a stable URL avoids re-registering the bot on
every launch. The tunnel maps **only** the `/groupme/callback` path; the config
GUI is never routed through it.

### 2. Callback server
A minimal HTTP server (framework-free or Fastify) with:
- `POST /groupme/callback` — receives GroupMe message payloads.
- `GET /` — serves the config form (localhost only).
- `POST /config` — writes the config form back to `config.yaml` (localhost only).

Incoming callbacks are deduped by message `id` (GroupMe may retry delivery).

### 3. Gateway / filter
For each callback payload:
- Drop messages where `sender_type === "bot"` (prevents the bot replying to
  itself / other bots — infinite loops).
- Drop messages whose `sender_id` is not `allowed_sender_id` (silently ignored,
  no reply, logged — avoids confirming the bridge exists to strangers).
- Route the remaining messages to one of: the **confirmation-reply handler** (if a
  permission request is pending), the **command handler** (message starts with
  `/`), or the **agent runner**.

### 4. Session manager
Persists the current `session_id` and a list of recent sessions to a small JSON
state file. Backs `/new` (drop current id → next message starts fresh),
`/resume [id|n]` (load a prior id), and `/sessions` (list recent session
summaries via the SDK's `listSessions()`).

### 5. Agent runner
For each agent-bound message, calls:

```ts
query({
  prompt,
  options: {
    resume: storedSessionId,            // omitted when starting fresh
    cwd: workspaceDir,
    model,
    maxTurns,
    permissionMode: "default",          // ensures canUseTool is consulted
    allowedTools: ["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"],
    canUseTool: permissionBroker,
    systemPrompt: { type: "preset", preset: "claude_code", append: SMS_RULES },
    // settingSources defaults include "project", so workspace CLAUDE.md loads
  }
})
```

It streams messages, accumulates the assistant's text, and captures the new
`session_id` from the stream to persist via the session manager. On completion it
passes the accumulated text to the outbound sender.

### 6. Permission broker (`canUseTool`)
The heart of SMS-confirm. Signature:
`(toolName, input, opts) => Promise<PermissionResult>`.

- **Read-only / safe tools** (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`,
  `WebSearch`) — return `{ behavior: "allow" }` immediately. (These are also in
  `allowedTools`, so the callback is mostly hit by the risky set.)
- **Risky tools** — all `Bash`, and file writes (`Write`, `Edit`,
  `NotebookEdit`): post a confirmation message to GroupMe, e.g.
  `⚠️ Claude wants to run Bash: rm foo.txt — reply YES to allow, NO to deny`,
  then `await` a correlated reply through a pending-promise registry. On `YES`
  → `{ behavior: "allow" }`; on `NO` → `{ behavior: "deny", message }`; on a
  5-minute timeout → deny.

Risk classification lives in one small, tunable module so the gated set is easy
to change. Because only one agent turn runs at a time, there is at most one
outstanding permission request.

### 7. Outbound sender
Posts replies via `POST https://api.groupme.com/v3/bots/post` with `bot_id` and
`text`. Splits long replies into ~900-character chunks (under GroupMe's limit)
and sends them in order with a small inter-chunk delay. Retries failed posts with
backoff.

## Configuration

### `config.yaml` (gitignored) // add a template that is not ignored
Single human-editable file, loaded and validated at startup:

```yaml
groupme:
  access_token: ""       # GroupMe API token
  bot_id: ""             # from POST /bots
  group_id: ""
  allowed_sender_id: ""  # only this GroupMe user can drive the agent
agent:
  workspace_dir: "~/yeshivish-workspace"
  model: "claude-opus-4-8"
  max_turns: 30
  auto_allow_read_tools: true   # reads auto-approved; writes/Bash need YES
server:
  port: 8787             # local callback + GUI port
tunnel:
  mode: "named"          # named (stable URL) | quick
  hostname: ""           # public hostname for the named tunnel
```

Agent credentials come from the existing Claude Code login or
`ANTHROPIC_API_KEY` in the environment (kept out of `config.yaml`).

### Config GUI
`GET /` serves a plain HTML form (no framework, no build step) pre-filled from
`config.yaml`. `POST /config` writes the values back to the YAML file and reloads
config in memory. **Bound to `localhost` only and never routed through the
tunnel**, so the page holding the tokens is unreachable from the internet.

### Built-in `CLAUDE.md`
Shipped into `WORKSPACE_DIR` and auto-loaded by the SDK (project settings load by
default). It is the source of truth for SMS-style behavior; the same rules are
mirrored into `systemPrompt.append` (`SMS_RULES`) so behavior holds even if the
file is edited. Directives:

- Plain text only — no markdown, no code fences, no bullet/table characters, no
  headings.
- Be concise — answer in a few short sentences; assume every character costs an
  SMS.
- Long output is split across multiple texts, so minimize length; summarize
  rather than dump.
- No links or emoji unless asked; lead with the answer, skip preamble.

## Data Flow

```
SMS → GroupMe group → GroupMe POST → cloudflared tunnel → callback server
  → gateway/filter
     ├─ pending confirmation + YES/NO → resolve permission broker's promise
     ├─ message starts with "/"       → command handler (session mgr / help)
     └─ otherwise                      → enqueue prompt → agent runner
                                           (canUseTool may pause to text the user)
                                           → accumulate reply → outbound sender
                                           → chunked post → arrives as SMS
```

## Concurrency

One in-flight agent turn at a time, guarded by a lock; additional agent-bound
prompts queue FIFO. Confirmation replies (`YES`/`NO`) bypass the queue — they are
routed straight to the pending permission promise. `/stop` fires the query's
`AbortSignal` to cancel the current turn.

## Command Vocabulary

| Command | Effect |
| --- | --- |
| `/new` | Reset to a fresh session (drop stored `session_id`) |
| `/resume [id\|n]` | Resume a prior session (most recent, or by id/index) |
| `/sessions` | List recent sessions with summaries |
| `/help` | List available commands |
| `/stop` | Abort the current in-flight turn |
| `YES` / `NO` (`y`/`n`) | Answer a pending confirmation |

## Error Handling

- GroupMe `bots/post` failures → retry with backoff.
- Agent errors → post a short error message to the group.
- Duplicate callbacks → deduped by message `id`.
- Unauthorized sender → silently ignored and logged.
- Permission request timeout (5 min) → deny.
- Tunnel / process supervised externally for restart.

## Security Notes

- Single-sender allowlist is the primary access control.
- Agent confined to `WORKSPACE_DIR`, not the home directory — limits blast radius.
- `permissionMode: "default"` ensures `canUseTool` gates everything not explicitly
  allowed.
- SMS is plaintext; the `YES`/`NO` gate is the main guard for risky operations,
  and reads within the workspace are auto-allowed by design.
- Secrets live in gitignored `config.yaml` / environment; the config GUI is
  localhost-only and never tunneled.

## Testing Strategy

- **Unit:** gateway filter (sender allow/deny, bot drop, command parsing), risk
  classifier, message chunker, session-state manager, permission broker
  (resolve on YES/NO and timeout-denies).
- **Integration:** mock a GroupMe callback POST and assert `bots/post` is called
  with the expected text; mock the SDK `query()` to drive `canUseTool` through
  allow / confirm-YES / confirm-NO / timeout paths; config load/save round-trip.
- **Manual:** real cloudflared tunnel + real GroupMe group + real phone over SMS.

## Open Operational Notes

- First-run setup: create the GroupMe bot (`POST /bots`) pointed at the stable
  tunnel hostname, capture `bot_id`, and fill `config.yaml` via the GUI.
- The named tunnel requires a cloudflared-managed hostname; document the
  one-time `cloudflared tunnel` setup in the project README during implementation.
