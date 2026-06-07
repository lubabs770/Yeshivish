# Claude Code over SMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TypeScript app on the PC that lets a single authorized user drive a Claude Code agent session over SMS via a GroupMe bot, gating risky actions behind an SMS confirmation.

**Architecture:** A localhost HTTP server receives GroupMe message callbacks (exposed via a cloudflared tunnel), filters/routes them, and for prompts runs a per-message `query()` against the Claude Agent SDK resuming a stored session id. The SDK's `canUseTool` callback posts a YES/NO confirmation back over GroupMe for risky tools and awaits the reply. Replies are chunked and posted to the group.

**Tech Stack:** Node 24, TypeScript (ESM), `@anthropic-ai/claude-agent-sdk`, `js-yaml`, native `node:http` and `fetch`, `vitest` for tests, `tsx` to run TS directly, `cloudflared` for the tunnel.

---

## File Structure

```
yeshivish/
  package.json                  # deps + scripts (type: module)
  tsconfig.json                 # TS config (ESM, strict)
  vitest.config.ts              # test config
  .gitignore                    # ignores config.yaml, node_modules, state
  config.example.yaml           # committed template (NOT ignored)
  src/
    types.ts                    # shared types (Config, GroupMeCallback, decisions)
    config.ts                   # load/validate/save config.yaml, ~ expansion
    chunk.ts                    # split long replies into GroupMe-sized chunks
    risk.ts                     # classify a tool as auto-allow vs confirm + describe
    session-store.ts            # persist current + recent session ids
    groupme.ts                  # outbound sender: chunk + POST to bots/post w/ retry
    commands.ts                 # parse & handle /new /resume /sessions /help /stop
    permission-broker.ts        # canUseTool: classify, post YES/NO, await reply
    agent.ts                    # run one query() turn, accumulate text, capture id
    sms-rules.ts                # SMS_RULES string, CLAUDE.md content, workspace bootstrap
    gateway.ts                  # filter (sender/bot/dedupe) + route to a Decision
    turn-queue.ts               # serialize agent turns, expose abort for /stop
    gui.ts                      # render config HTML form + parse form body
    server.ts                   # node:http server: callback + GUI routes (localhost guard)
    tunnel.ts                   # optionally spawn cloudflared based on config
    index.ts                    # entrypoint: load config, wire everything, listen
  tests/                        # one *.test.ts per module above
```

Each module has one responsibility and is unit-testable with injected dependencies (fetch, the SDK `query`, the file path). `index.ts` is the only file that wires real dependencies together.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `config.example.yaml`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "yeshivish",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
config.yaml
state.json
*.log
```

- [ ] **Step 5: Create `config.example.yaml`** (committed template the user copies to `config.yaml`)

```yaml
groupme:
  access_token: ""       # GroupMe API token (dev.groupme.com)
  bot_id: ""             # returned from POST /bots
  group_id: ""           # the group the bot lives in
  allowed_sender_id: ""  # ONLY this GroupMe user can drive the agent
agent:
  workspace_dir: "~/yeshivish-workspace"  # agent runs confined here
  model: "claude-opus-4-8"
  max_turns: 30
  auto_allow_read_tools: true   # reads auto-approved; writes/Bash require YES
server:
  port: 8787             # local callback + config GUI port
tunnel:
  mode: "named"          # named (stable URL) | quick
  hostname: ""           # public hostname for the named tunnel
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: dependencies install, `node_modules/` created, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore config.example.yaml package-lock.json
git commit -m "chore: scaffold yeshivish project (TS, vitest, config template)"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

No test (pure type declarations). The first module that uses them (Task 3+) exercises them via `typecheck`.

- [ ] **Step 1: Create `src/types.ts`**

```ts
export interface Config {
  groupme: {
    access_token: string;
    bot_id: string;
    group_id: string;
    allowed_sender_id: string;
  };
  agent: {
    workspace_dir: string;
    model: string;
    max_turns: number;
    auto_allow_read_tools: boolean;
  };
  server: { port: number };
  tunnel: { mode: "named" | "quick"; hostname: string };
}

// The JSON GroupMe POSTs to the callback URL on every group message.
export interface GroupMeCallback {
  id: string;
  text: string | null;
  name: string;
  sender_id: string;
  sender_type: "user" | "bot" | "system";
  group_id: string;
  created_at: number;
  attachments: unknown[];
}

// What the gateway decides to do with an incoming callback.
export type Decision =
  | { kind: "ignore" }
  | { kind: "confirm"; allowed: boolean }
  | { kind: "command"; text: string }
  | { kind: "prompt"; text: string };

// Mirrors the Agent SDK PermissionResult shape we use.
export type PermissionResult =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared types"
```

---

## Task 3: Message chunker

**Files:**
- Create: `src/chunk.ts`
- Test: `tests/chunk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { chunkText } from "../src/chunk.js";

describe("chunkText", () => {
  it("returns a single chunk when under the limit", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("returns an empty-string chunk for empty input", () => {
    expect(chunkText("", 100)).toEqual([""]);
  });

  it("splits on newline boundaries when possible", () => {
    const out = chunkText("aaa\nbbb\nccc", 7);
    expect(out).toEqual(["aaa\nbbb", "ccc"]);
  });

  it("hard-splits a single run longer than the limit", () => {
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never emits a chunk longer than maxLen", () => {
    const out = chunkText("word ".repeat(500), 900);
    expect(out.every((c) => c.length <= 900)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/chunk.test.ts`
Expected: FAIL with "Cannot find module '../src/chunk.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/chunk.ts
// Split text into chunks no longer than maxLen, preferring to break on
// newlines, then spaces, falling back to a hard character split.
export function chunkText(text: string, maxLen = 900): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;

  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf("\n", maxLen);
    if (cut <= 0) cut = rest.lastIndexOf(" ", maxLen);
    if (cut <= 0) cut = maxLen; // no break point: hard split

    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^[\n ]/, ""); // drop the boundary char
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/chunk.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/chunk.ts tests/chunk.test.ts
git commit -m "feat: add reply chunker"
```

---

## Task 4: Risk classifier

**Files:**
- Create: `src/risk.ts`
- Test: `tests/risk.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { classifyTool, describeTool } from "../src/risk.js";

describe("classifyTool", () => {
  it("auto-allows read-only tools when autoAllow is true", () => {
    expect(classifyTool("Read", true)).toBe("allow");
    expect(classifyTool("Grep", true)).toBe("allow");
    expect(classifyTool("WebFetch", true)).toBe("allow");
  });

  it("confirms read-only tools when autoAllow is false", () => {
    expect(classifyTool("Read", false)).toBe("confirm");
  });

  it("always confirms Bash and writes", () => {
    expect(classifyTool("Bash", true)).toBe("confirm");
    expect(classifyTool("Write", true)).toBe("confirm");
    expect(classifyTool("Edit", true)).toBe("confirm");
    expect(classifyTool("NotebookEdit", true)).toBe("confirm");
  });

  it("confirms unknown tools by default", () => {
    expect(classifyTool("SomeMcpTool", true)).toBe("confirm");
  });
});

describe("describeTool", () => {
  it("summarizes a Bash command", () => {
    expect(describeTool("Bash", { command: "rm foo.txt" })).toBe(
      "Bash: rm foo.txt",
    );
  });

  it("summarizes a Write with the file path", () => {
    expect(describeTool("Write", { file_path: "/tmp/x.ts" })).toBe(
      "Write: /tmp/x.ts",
    );
  });

  it("falls back to the tool name when no detail is known", () => {
    expect(describeTool("Edit", {})).toBe("Edit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/risk.test.ts`
Expected: FAIL with "Cannot find module '../src/risk.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/risk.ts
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
]);

// Returns "allow" if the tool may run without asking, "confirm" if it needs
// an SMS YES. Read-only tools are allowed only when autoAllow is enabled;
// everything else (Bash, writes, unknown tools) always confirms.
export function classifyTool(
  toolName: string,
  autoAllow: boolean,
): "allow" | "confirm" {
  if (autoAllow && READ_ONLY_TOOLS.has(toolName)) return "allow";
  return "confirm";
}

// Short human-readable summary of a tool call for the confirmation SMS.
export function describeTool(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    return `Bash: ${input.command}`;
  }
  if (typeof input.file_path === "string") {
    return `${toolName}: ${input.file_path}`;
  }
  return toolName;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/risk.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/risk.ts tests/risk.test.ts
git commit -m "feat: add tool risk classifier"
```

---

## Task 5: Session store

**Files:**
- Create: `src/session-store.ts`
- Test: `tests/session-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";

let path: string;
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), "yesh-")), "state.json");
});

describe("SessionStore", () => {
  it("starts with no current session", () => {
    const store = new SessionStore(path);
    expect(store.currentSessionId()).toBeNull();
  });

  it("sets and persists the current session id", () => {
    new SessionStore(path).setCurrent("abc");
    expect(new SessionStore(path).currentSessionId()).toBe("abc");
  });

  it("clearCurrent drops the id but keeps it in recent", () => {
    const store = new SessionStore(path);
    store.setCurrent("abc");
    store.clearCurrent();
    expect(store.currentSessionId()).toBeNull();
  });

  it("recordCompleted prepends to recent (newest first, deduped)", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    store.recordCompleted("b");
    store.recordCompleted("a");
    expect(store.listRecent(5).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("resume(undefined) returns the most recent id and makes it current", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    store.recordCompleted("b");
    expect(store.resume()).toBe("b");
    expect(store.currentSessionId()).toBe("b");
  });

  it("resume(id) returns that id when present, null otherwise", () => {
    const store = new SessionStore(path);
    store.recordCompleted("a");
    expect(store.resume("a")).toBe("a");
    expect(store.resume("zzz")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/session-store.test.ts`
Expected: FAIL with "Cannot find module '../src/session-store.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/session-store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/session-store.ts tests/session-store.test.ts
git commit -m "feat: add session store"
```

---

## Task 6: GroupMe outbound sender

**Files:**
- Create: `src/groupme.ts`
- Test: `tests/groupme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { createSender } from "../src/groupme.js";

const cfg = {
  groupme: { bot_id: "BOT", access_token: "TOK", group_id: "G", allowed_sender_id: "U" },
} as any;

describe("createSender", () => {
  it("posts a single message to bots/post with bot_id and text", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await createSender(cfg, fetchFn).send("hi");

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.groupme.com/v3/bots/post");
    expect(JSON.parse(init.body)).toEqual({ bot_id: "BOT", text: "hi" });
  });

  it("splits long text into multiple posts", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });
    await createSender(cfg, fetchFn).send("x".repeat(2000));
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("retries once on failure then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });
    await createSender(cfg, fetchFn).send("hi");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/groupme.test.ts`
Expected: FAIL with "Cannot find module '../src/groupme.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/groupme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/groupme.ts tests/groupme.test.ts
git commit -m "feat: add GroupMe outbound sender"
```

---

## Task 7: Config loader

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, validateConfig, expandHome } from "../src/config.js";

function tmpFile(contents: string): string {
  const p = join(mkdtempSync(join(tmpdir(), "yesh-cfg-")), "config.yaml");
  writeFileSync(p, contents);
  return p;
}

const VALID = `
groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" }
agent: { workspace_dir: "~/ws", model: "claude-opus-4-8", max_turns: 30, auto_allow_read_tools: true }
server: { port: 8787 }
tunnel: { mode: "named", hostname: "h" }
`;

describe("expandHome", () => {
  it("expands a leading ~", () => {
    expect(expandHome("~/ws")).toBe(join(homedir(), "ws"));
  });
  it("leaves absolute paths untouched", () => {
    expect(expandHome("/tmp/x")).toBe("/tmp/x");
  });
});

describe("loadConfig", () => {
  it("loads and expands workspace_dir", () => {
    const cfg = loadConfig(tmpFile(VALID));
    expect(cfg.groupme.bot_id).toBe("B");
    expect(cfg.agent.workspace_dir).toBe(join(homedir(), "ws"));
  });
});

describe("validateConfig", () => {
  it("returns no errors for a complete config", () => {
    expect(validateConfig(loadConfig(tmpFile(VALID)))).toEqual([]);
  });
  it("reports missing required groupme fields", () => {
    const bad = loadConfig(tmpFile(VALID));
    bad.groupme.bot_id = "";
    expect(validateConfig(bad)).toContain("groupme.bot_id is required");
  });
});

describe("saveConfig", () => {
  it("round-trips through YAML", () => {
    const p = tmpFile(VALID);
    const cfg = loadConfig(p);
    cfg.agent.model = "claude-haiku-4-5-20251001";
    saveConfig(p, cfg);
    expect(readFileSync(p, "utf8")).toContain("claude-haiku-4-5-20251001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL with "Cannot find module '../src/config.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/config.ts
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Config } from "./types.js";

export function expandHome(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

// Parse the YAML config and expand ~ in workspace_dir. Does not validate;
// call validateConfig separately so the GUI can show field-level errors.
export function loadConfig(path: string): Config {
  const cfg = yaml.load(readFileSync(path, "utf8")) as Config;
  cfg.agent.workspace_dir = expandHome(cfg.agent.workspace_dir);
  return cfg;
}

export function saveConfig(path: string, cfg: Config): void {
  writeFileSync(path, yaml.dump(cfg));
}

// Returns a list of human-readable problems; empty array means valid.
export function validateConfig(cfg: Config): string[] {
  const errors: string[] = [];
  const required: [string, unknown][] = [
    ["groupme.access_token", cfg.groupme.access_token],
    ["groupme.bot_id", cfg.groupme.bot_id],
    ["groupme.group_id", cfg.groupme.group_id],
    ["groupme.allowed_sender_id", cfg.groupme.allowed_sender_id],
    ["agent.workspace_dir", cfg.agent.workspace_dir],
  ];
  for (const [name, value] of required) {
    if (!value) errors.push(`${name} is required`);
  }
  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config loader/validator"
```

---

## Task 8: Command handler

**Files:**
- Create: `src/commands.ts`
- Test: `tests/commands.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";
import { isCommand, handleCommand } from "../src/commands.js";

let store: SessionStore;
beforeEach(() => {
  store = new SessionStore(join(mkdtempSync(join(tmpdir(), "yesh-")), "s.json"));
});

describe("isCommand", () => {
  it("detects a leading slash", () => {
    expect(isCommand("/new")).toBe(true);
    expect(isCommand("hello")).toBe(false);
  });
});

describe("handleCommand", () => {
  it("/new clears the current session", () => {
    store.setCurrent("abc");
    const res = handleCommand("/new", { store });
    expect(store.currentSessionId()).toBeNull();
    expect(res.reply).toMatch(/new session/i);
  });

  it("/resume with no recent sessions reports nothing to resume", () => {
    const res = handleCommand("/resume", { store });
    expect(res.reply).toMatch(/no .*session/i);
  });

  it("/resume restores the most recent session", () => {
    store.recordCompleted("a");
    store.recordCompleted("b");
    const res = handleCommand("/resume", { store });
    expect(store.currentSessionId()).toBe("b");
    expect(res.reply).toMatch(/b/);
  });

  it("/stop signals an abort", () => {
    expect(handleCommand("/stop", { store }).abort).toBe(true);
  });

  it("/help lists commands", () => {
    expect(handleCommand("/help", { store }).reply).toMatch(/\/new/);
  });

  it("unknown command returns a hint", () => {
    expect(handleCommand("/wat", { store }).reply).toMatch(/unknown/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/commands.test.ts`
Expected: FAIL with "Cannot find module '../src/commands.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/commands.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "feat: add command handler"
```

---

## Task 9: Gateway (filter + route)

**Files:**
- Create: `src/gateway.ts`
- Test: `tests/gateway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { decide } from "../src/gateway.js";
import type { GroupMeCallback } from "../src/types.js";

const cfg = { groupme: { allowed_sender_id: "U" } } as any;

function msg(over: Partial<GroupMeCallback>): GroupMeCallback {
  return {
    id: "1", text: "hi", name: "n", sender_id: "U", sender_type: "user",
    group_id: "G", created_at: 0, attachments: [], ...over,
  };
}

function deps(pending = false) {
  return { cfg, seen: new Set<string>(), hasPending: () => pending };
}

describe("decide", () => {
  it("ignores messages from other senders", () => {
    expect(decide(msg({ sender_id: "X" }), deps()).kind).toBe("ignore");
  });

  it("ignores bot-authored messages", () => {
    expect(decide(msg({ sender_type: "bot" }), deps()).kind).toBe("ignore");
  });

  it("ignores duplicate message ids", () => {
    const d = deps();
    decide(msg({ id: "dup" }), d);
    expect(decide(msg({ id: "dup" }), d).kind).toBe("ignore");
  });

  it("routes YES to a confirm:true when a permission is pending", () => {
    expect(decide(msg({ text: "yes" }), deps(true))).toEqual({
      kind: "confirm", allowed: true,
    });
  });

  it("routes NO to a confirm:false when a permission is pending", () => {
    expect(decide(msg({ text: "no" }), deps(true))).toEqual({
      kind: "confirm", allowed: false,
    });
  });

  it("routes a slash message to a command", () => {
    expect(decide(msg({ text: "/new" }), deps())).toEqual({
      kind: "command", text: "/new",
    });
  });

  it("routes plain text to a prompt", () => {
    expect(decide(msg({ text: "do a thing" }), deps())).toEqual({
      kind: "prompt", text: "do a thing",
    });
  });

  it("ignores empty/null text", () => {
    expect(decide(msg({ text: null }), deps()).kind).toBe("ignore");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gateway.test.ts`
Expected: FAIL with "Cannot find module '../src/gateway.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/gateway.ts
import type { Config, GroupMeCallback, Decision } from "./types.js";
import { isCommand } from "./commands.js";

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gateway.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts tests/gateway.test.ts
git commit -m "feat: add gateway filter/router"
```

---

## Task 10: Permission broker

**Files:**
- Create: `src/permission-broker.ts`
- Test: `tests/permission-broker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { PermissionBroker } from "../src/permission-broker.js";

function makeBroker(autoAllow = true) {
  const sent: string[] = [];
  const broker = new PermissionBroker({
    send: async (t) => { sent.push(t); },
    autoAllowReadTools: autoAllow,
    timeoutMs: 50,
  });
  return { broker, sent };
}

describe("PermissionBroker", () => {
  it("auto-allows read tools without sending anything", async () => {
    const { broker, sent } = makeBroker();
    const res = await broker.canUseTool("Read", { file_path: "/x" }, {});
    expect(res).toEqual({ behavior: "allow" });
    expect(sent).toEqual([]);
    expect(broker.hasPending()).toBe(false);
  });

  it("posts a confirmation for Bash and allows on YES", async () => {
    const { broker, sent } = makeBroker();
    const p = broker.canUseTool("Bash", { command: "ls" }, {});
    // allow the microtask that posts the confirmation to run
    await Promise.resolve();
    expect(sent[0]).toMatch(/Bash: ls/);
    expect(broker.hasPending()).toBe(true);
    broker.resolvePending(true);
    expect(await p).toEqual({ behavior: "allow" });
    expect(broker.hasPending()).toBe(false);
  });

  it("denies on NO", async () => {
    const { broker } = makeBroker();
    const p = broker.canUseTool("Write", { file_path: "/x" }, {});
    await Promise.resolve();
    broker.resolvePending(false);
    const res = await p;
    expect(res.behavior).toBe("deny");
  });

  it("denies on timeout", async () => {
    const { broker } = makeBroker();
    const res = await broker.canUseTool("Bash", { command: "ls" }, {});
    expect(res.behavior).toBe("deny");
  });

  it("resolvePending returns false when nothing is pending", () => {
    const { broker } = makeBroker();
    expect(broker.resolvePending(true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/permission-broker.test.ts`
Expected: FAIL with "Cannot find module '../src/permission-broker.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
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

    const allowed = await this.ask(describeTool(toolName, input));
    return allowed
      ? { behavior: "allow" }
      : { behavior: "deny", message: "Denied by SMS (no confirmation)." };
  }

  private ask(summary: string): Promise<boolean> {
    const timeoutMs = this.deps.timeoutMs ?? 5 * 60 * 1000;
    void this.deps.send(
      `⚠️ Claude wants to run ${summary} — reply YES to allow, NO to deny.`,
    );
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null;
        resolve(false);
      }, timeoutMs);
      this.pending = { resolve, timer };
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/permission-broker.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/permission-broker.ts tests/permission-broker.test.ts
git commit -m "feat: add SMS-confirm permission broker"
```

---

## Task 11: SMS rules + workspace bootstrap

**Files:**
- Create: `src/sms-rules.ts`
- Test: `tests/sms-rules.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SMS_RULES, CLAUDE_MD, bootstrapWorkspace } from "../src/sms-rules.js";

describe("SMS rules content", () => {
  it("mentions no markdown and conciseness", () => {
    expect(SMS_RULES.toLowerCase()).toContain("markdown");
    expect(SMS_RULES.toLowerCase()).toContain("concise");
  });
  it("CLAUDE_MD embeds the rules", () => {
    expect(CLAUDE_MD).toContain(SMS_RULES);
  });
});

describe("bootstrapWorkspace", () => {
  it("creates the dir and writes CLAUDE.md when absent", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "yesh-ws-")), "nested");
    bootstrapWorkspace(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe(CLAUDE_MD);
  });
  it("does not overwrite an existing CLAUDE.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "yesh-ws-"));
    writeFileSync(join(dir, "CLAUDE.md"), "custom");
    bootstrapWorkspace(dir);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("custom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sms-rules.test.ts`
Expected: FAIL with "Cannot find module '../src/sms-rules.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/sms-rules.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Behavioral rules injected both as systemPrompt.append and via the workspace
// CLAUDE.md, so replies stay SMS-friendly.
export const SMS_RULES = [
  "You are replying to the user over SMS (through GroupMe). Follow these rules:",
  "- Plain text only. No markdown, no code fences, no bullet characters, no tables, no headings.",
  "- Be concise. Answer in a few short sentences; every character costs an SMS.",
  "- Long output is split across multiple texts, so minimize length and summarize instead of dumping.",
  "- No links or emoji unless asked. Lead with the answer; skip preamble.",
].join("\n");

export const CLAUDE_MD = `# Workspace instructions

${SMS_RULES}
`;

// Ensure the workspace dir exists and seed CLAUDE.md once. Never overwrites an
// existing CLAUDE.md so the user can edit it as the source of truth.
export function bootstrapWorkspace(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const claudeMd = join(dir, "CLAUDE.md");
  if (!existsSync(claudeMd)) writeFileSync(claudeMd, CLAUDE_MD);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sms-rules.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/sms-rules.ts tests/sms-rules.test.ts
git commit -m "feat: add SMS rules and workspace bootstrap"
```

---

## Task 12: Agent runner

**Files:**
- Create: `src/agent.ts`
- Test: `tests/agent.test.ts`

The Agent SDK's `query()` returns an async generator of messages. We inject it
as `queryFn` so tests can supply a fake stream. We accumulate text from
`assistant` messages and capture `session_id` from the `system`/`result`
messages.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session-store.js";
import { runTurn } from "../src/agent.js";

function fakeStream(messages: any[]) {
  return async function* () {
    for (const m of messages) yield m;
  };
}

let store: SessionStore;
beforeEach(() => {
  store = new SessionStore(join(mkdtempSync(join(tmpdir(), "yesh-")), "s.json"));
});

const cfg = {
  agent: { workspace_dir: "/ws", model: "m", max_turns: 5, auto_allow_read_tools: true },
} as any;
const broker = { canUseTool: vi.fn() } as any;

describe("runTurn", () => {
  it("accumulates assistant text and captures the session id", async () => {
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([
        { type: "system", subtype: "init", session_id: "S1" },
        { type: "assistant", message: { content: [{ type: "text", text: "Hello" }] } },
        { type: "result", session_id: "S1", subtype: "success" },
      ]))(),
    );

    const res = await runTurn("hi", { cfg, store, broker, queryFn });
    expect(res.text).toBe("Hello");
    expect(res.sessionId).toBe("S1");
    expect(store.currentSessionId()).toBe("S1");
  });

  it("passes resume when a session is current", async () => {
    store.setCurrent("PREV");
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([{ type: "result", session_id: "PREV", subtype: "success" }]))(),
    );
    await runTurn("again", { cfg, store, broker, queryFn });
    const opts = queryFn.mock.calls[0][0].options;
    expect(opts.resume).toBe("PREV");
    expect(opts.cwd).toBe("/ws");
    expect(opts.canUseTool).toBeTypeOf("function");
  });

  it("omits resume when no session is current", async () => {
    const queryFn = vi.fn().mockReturnValue(
      (fakeStream([{ type: "result", session_id: "NEW", subtype: "success" }]))(),
    );
    await runTurn("first", { cfg, store, broker, queryFn });
    expect(queryFn.mock.calls[0][0].options.resume).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/agent.test.ts`
Expected: FAIL with "Cannot find module '../src/agent.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
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

  const options: Record<string, unknown> = {
    cwd: cfg.agent.workspace_dir,
    model: cfg.agent.model,
    maxTurns: cfg.agent.max_turns,
    permissionMode: "default",
    allowedTools: ["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"],
    canUseTool: broker.canUseTool.bind(broker),
    systemPrompt: { type: "preset", preset: "claude_code", append: SMS_RULES },
    abortController: deps.signal ? { signal: deps.signal } : undefined,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/agent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts tests/agent.test.ts
git commit -m "feat: add agent runner"
```

---

## Task 13: Turn queue

**Files:**
- Create: `src/turn-queue.ts`
- Test: `tests/turn-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { TurnQueue } from "../src/turn-queue.js";

describe("TurnQueue", () => {
  it("runs tasks serially in order", async () => {
    const q = new TurnQueue();
    const log: number[] = [];
    const mk = (n: number) => async () => {
      await new Promise((r) => setTimeout(r, 5));
      log.push(n);
    };
    q.enqueue(mk(1));
    q.enqueue(mk(2));
    await q.idle();
    expect(log).toEqual([1, 2]);
  });

  it("abortCurrent aborts the in-flight task's signal", async () => {
    const q = new TurnQueue();
    let aborted = false;
    q.enqueue(async (signal) => {
      await new Promise((r) => setTimeout(r, 20));
      aborted = signal.aborted;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(q.abortCurrent()).toBe(true);
    await q.idle();
    expect(aborted).toBe(true);
  });

  it("abortCurrent returns false when idle", () => {
    expect(new TurnQueue().abortCurrent()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/turn-queue.test.ts`
Expected: FAIL with "Cannot find module '../src/turn-queue.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/turn-queue.ts
type Task = (signal: AbortSignal) => Promise<void>;

// Serializes agent turns so only one runs at a time. abortCurrent() cancels the
// in-flight task via its AbortSignal (used by /stop).
export class TurnQueue {
  private chain: Promise<void> = Promise.resolve();
  private current: AbortController | null = null;

  enqueue(task: Task): void {
    this.chain = this.chain.then(async () => {
      const ac = new AbortController();
      this.current = ac;
      try {
        await task(ac.signal);
      } catch (err) {
        console.error("turn failed:", err);
      } finally {
        this.current = null;
      }
    });
  }

  abortCurrent(): boolean {
    if (!this.current) return false;
    this.current.abort();
    return true;
  }

  // Resolves when the current chain of work has drained (test helper).
  idle(): Promise<void> {
    return this.chain;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/turn-queue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/turn-queue.ts tests/turn-queue.test.ts
git commit -m "feat: add serial turn queue with abort"
```

---

## Task 14: Config GUI rendering

**Files:**
- Create: `src/gui.ts`
- Test: `tests/gui.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { renderConfigForm, formBodyToConfig } from "../src/gui.js";

const cfg = {
  groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" },
  agent: { workspace_dir: "/ws", model: "m", max_turns: 30, auto_allow_read_tools: true },
  server: { port: 8787 },
  tunnel: { mode: "named", hostname: "h" },
} as any;

describe("renderConfigForm", () => {
  it("renders an HTML form pre-filled with current values", () => {
    const html = renderConfigForm(cfg);
    expect(html).toContain("<form");
    expect(html).toContain('value="B"'); // bot_id
    expect(html).toContain('name="groupme.bot_id"');
  });
});

describe("formBodyToConfig", () => {
  it("maps dotted form fields back into the config, coercing types", () => {
    const next = formBodyToConfig(
      {
        "groupme.access_token": "T2",
        "groupme.bot_id": "B2",
        "groupme.group_id": "G",
        "groupme.allowed_sender_id": "U",
        "agent.workspace_dir": "/ws2",
        "agent.model": "m",
        "agent.max_turns": "40",
        "agent.auto_allow_read_tools": "on",
        "server.port": "9000",
        "tunnel.mode": "quick",
        "tunnel.hostname": "",
      },
      cfg,
    );
    expect(next.groupme.bot_id).toBe("B2");
    expect(next.agent.max_turns).toBe(40);
    expect(next.agent.auto_allow_read_tools).toBe(true);
    expect(next.server.port).toBe(9000);
    expect(next.tunnel.mode).toBe("quick");
  });

  it("treats a missing checkbox as false", () => {
    const next = formBodyToConfig(
      { "agent.auto_allow_read_tools": "" } as any,
      cfg,
    );
    expect(next.agent.auto_allow_read_tools).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gui.test.ts`
Expected: FAIL with "Cannot find module '../src/gui.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/gui.ts
import type { Config } from "./types.js";

function esc(v: unknown): string {
  return String(v).replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function field(name: string, value: unknown): string {
  return `<label>${name}<input name="${name}" value="${esc(value)}"></label>`;
}

// Renders a dead-simple HTML form pre-filled from the current config.
export function renderConfigForm(cfg: Config): string {
  const checked = cfg.agent.auto_allow_read_tools ? "checked" : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<title>yeshivish config</title>
<style>body{font-family:system-ui;max-width:40rem;margin:2rem auto}
label{display:block;margin:.5rem 0}input{width:100%}</style></head>
<body><h1>yeshivish config</h1>
<form method="post" action="/config">
${field("groupme.access_token", cfg.groupme.access_token)}
${field("groupme.bot_id", cfg.groupme.bot_id)}
${field("groupme.group_id", cfg.groupme.group_id)}
${field("groupme.allowed_sender_id", cfg.groupme.allowed_sender_id)}
${field("agent.workspace_dir", cfg.agent.workspace_dir)}
${field("agent.model", cfg.agent.model)}
${field("agent.max_turns", cfg.agent.max_turns)}
<label>agent.auto_allow_read_tools
<input type="checkbox" name="agent.auto_allow_read_tools" ${checked}></label>
${field("server.port", cfg.server.port)}
${field("tunnel.mode", cfg.tunnel.mode)}
${field("tunnel.hostname", cfg.tunnel.hostname)}
<button type="submit">Save</button>
</form></body></html>`;
}

// Maps a parsed form body (dotted keys) back into a Config, coercing numbers
// and the checkbox. Starts from `base` so untouched values survive.
export function formBodyToConfig(
  body: Record<string, string>,
  base: Config,
): Config {
  return {
    groupme: {
      access_token: body["groupme.access_token"] ?? base.groupme.access_token,
      bot_id: body["groupme.bot_id"] ?? base.groupme.bot_id,
      group_id: body["groupme.group_id"] ?? base.groupme.group_id,
      allowed_sender_id:
        body["groupme.allowed_sender_id"] ?? base.groupme.allowed_sender_id,
    },
    agent: {
      workspace_dir: body["agent.workspace_dir"] ?? base.agent.workspace_dir,
      model: body["agent.model"] ?? base.agent.model,
      max_turns: Number(body["agent.max_turns"] ?? base.agent.max_turns),
      auto_allow_read_tools: Boolean(body["agent.auto_allow_read_tools"]),
    },
    server: { port: Number(body["server.port"] ?? base.server.port) },
    tunnel: {
      mode: (body["tunnel.mode"] as "named" | "quick") ?? base.tunnel.mode,
      hostname: body["tunnel.hostname"] ?? base.tunnel.hostname,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gui.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/gui.ts tests/gui.test.ts
git commit -m "feat: add config GUI rendering"
```

---

## Task 15: HTTP server

**Files:**
- Create: `src/server.ts`
- Test: `tests/server.test.ts`

The server exposes the callback and the GUI. `/` and `/config` are guarded to
localhost-only requests (defense in depth; the tunnel forwards only the
callback path). The callback handler delegates to an injected `onCallback`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createServer } from "../src/server.js";

const cfg = {
  server: { port: 0 },
  groupme: { access_token: "T", bot_id: "B", group_id: "G", allowed_sender_id: "U" },
  agent: { workspace_dir: "/ws", model: "m", max_turns: 5, auto_allow_read_tools: true },
  tunnel: { mode: "named", hostname: "h" },
} as any;

let server: any;
afterEach(() => server?.close());

async function listen(deps: any) {
  server = createServer(deps);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("createServer", () => {
  it("invokes onCallback for POST /groupme/callback", async () => {
    const onCallback = vi.fn();
    const base = await listen({ getConfig: () => cfg, saveConfig: vi.fn(), onCallback });
    await fetch(`${base}/groupme/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "1", text: "hi", sender_id: "U", sender_type: "user" }),
    });
    expect(onCallback).toHaveBeenCalledOnce();
    expect(onCallback.mock.calls[0][0].text).toBe("hi");
  });

  it("serves the config form on GET /", async () => {
    const base = await listen({ getConfig: () => cfg, saveConfig: vi.fn(), onCallback: vi.fn() });
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain("<form");
  });

  it("saves config on POST /config", async () => {
    const saveConfig = vi.fn();
    const base = await listen({ getConfig: () => cfg, saveConfig, onCallback: vi.fn() });
    await fetch(`${base}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "groupme.bot_id=NEW&agent.max_turns=10&server.port=8787&tunnel.mode=named",
    });
    expect(saveConfig).toHaveBeenCalledOnce();
    expect(saveConfig.mock.calls[0][0].groupme.bot_id).toBe("NEW");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server.test.ts`
Expected: FAIL with "Cannot find module '../src/server.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/server.ts
import http from "node:http";
import type { Config, GroupMeCallback } from "./types.js";
import { renderConfigForm, formBodyToConfig } from "./gui.js";

export interface ServerDeps {
  getConfig: () => Config;
  saveConfig: (cfg: Config) => void;
  onCallback: (payload: GroupMeCallback) => void;
}

function isLocal(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

export function createServer(deps: ServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/groupme/callback") {
      const payload = JSON.parse((await readBody(req)) || "{}") as GroupMeCallback;
      deps.onCallback(payload);
      res.writeHead(200).end("ok");
      return;
    }

    // GUI routes are localhost-only.
    if (url.pathname === "/" || url.pathname === "/config") {
      if (!isLocal(req)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(renderConfigForm(deps.getConfig()));
        return;
      }
      if (req.method === "POST" && url.pathname === "/config") {
        const body = Object.fromEntries(
          new URLSearchParams(await readBody(req)),
        ) as Record<string, string>;
        deps.saveConfig(formBodyToConfig(body, deps.getConfig()));
        res.writeHead(303, { Location: "/" }).end();
        return;
      }
    }

    res.writeHead(404).end("not found");
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: add HTTP server (callback + localhost GUI)"
```

---

## Task 16: Tunnel helper

**Files:**
- Create: `src/tunnel.ts`
- Test: `tests/tunnel.test.ts`

Spawns `cloudflared` if configured and present. The spawn function is injected
so the test never launches a real process.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tunnel.test.ts`
Expected: FAIL with "Cannot find module '../src/tunnel.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tunnel.ts
import { spawn, type ChildProcess } from "node:child_process";
import type { Config } from "./types.js";

type SpawnFn = (cmd: string, args: string[], opts?: object) => ChildProcess;

// Start cloudflared for the configured tunnel. Named mode runs a pre-created
// tunnel by hostname (stable URL); quick mode opens an ephemeral tunnel to the
// local port. Returns null (no spawn) if a named tunnel has no hostname.
export function startTunnel(
  cfg: Config,
  spawnFn: SpawnFn = spawn,
): ChildProcess | null {
  let args: string[];
  if (cfg.tunnel.mode === "named") {
    if (!cfg.tunnel.hostname) return null;
    args = ["tunnel", "run", cfg.tunnel.hostname];
  } else {
    args = ["tunnel", "--url", `http://localhost:${cfg.server.port}`];
  }
  return spawnFn("cloudflared", args, { stdio: "inherit" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tunnel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tunnel.ts tests/tunnel.test.ts
git commit -m "feat: add cloudflared tunnel helper"
```

---

## Task 17: Entrypoint wiring

**Files:**
- Create: `src/index.ts`

This wires real dependencies. It has no unit test; it is verified by
`npm run typecheck` and the manual smoke test in Task 18.

- [ ] **Step 1: Write `src/index.ts`**

```ts
// src/index.ts
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, saveConfig as writeConfig, validateConfig } from "./config.js";
import type { Config, GroupMeCallback } from "./types.js";
import { SessionStore } from "./session-store.js";
import { createSender } from "./groupme.js";
import { PermissionBroker } from "./permission-broker.js";
import { decide } from "./gateway.js";
import { handleCommand } from "./commands.js";
import { runTurn, type QueryFn } from "./agent.js";
import { TurnQueue } from "./turn-queue.js";
import { bootstrapWorkspace } from "./sms-rules.js";
import { createServer } from "./server.js";
import { startTunnel } from "./tunnel.js";

const CONFIG_PATH = join(process.cwd(), "config.yaml");
const STATE_PATH = join(process.cwd(), "state.json");

let config: Config = loadConfig(CONFIG_PATH);
const problems = validateConfig(config);
if (problems.length) {
  console.warn("Config incomplete; open the GUI to fix:\n  " + problems.join("\n  "));
}

bootstrapWorkspace(config.agent.workspace_dir);

const store = new SessionStore(STATE_PATH);
const sender = createSender(config, fetch, { retries: 2, delayMs: 250 });
const broker = new PermissionBroker({
  send: (t) => sender.send(t),
  autoAllowReadTools: config.agent.auto_allow_read_tools,
});
const queue = new TurnQueue();
const seen = new Set<string>();

function onCallback(payload: GroupMeCallback): void {
  const decision = decide(payload, { cfg: config, seen, hasPending: () => broker.hasPending() });
  switch (decision.kind) {
    case "ignore":
      return;
    case "confirm":
      broker.resolvePending(decision.allowed);
      return;
    case "command": {
      const res = handleCommand(decision.text, { store });
      if (res.abort) queue.abortCurrent();
      if (res.reply) void sender.send(res.reply);
      return;
    }
    case "prompt":
      queue.enqueue(async (signal) => {
        try {
          const { text } = await runTurn(decision.text, {
            cfg: config,
            store,
            broker,
            queryFn: query as unknown as QueryFn,
            signal,
          });
          await sender.send(text || "(no output)");
        } catch (err) {
          await sender.send(`Error: ${(err as Error).message}`);
        }
      });
      return;
  }
}

const server = createServer({
  getConfig: () => config,
  saveConfig: (next) => {
    writeConfig(CONFIG_PATH, next);
    config = loadConfig(CONFIG_PATH);
  },
  onCallback,
});

server.listen(config.server.port, () => {
  console.log(`yeshivish listening on http://localhost:${config.server.port}`);
  console.log(`Config GUI: http://localhost:${config.server.port}/`);
});

const tunnel = startTunnel(config);
if (tunnel) console.log(`cloudflared started (pid ${tunnel.pid}).`);
else console.log("No tunnel started; run cloudflared manually (see README).");
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. If the installed SDK's `query` signature differs from `QueryFn`, the `as unknown as QueryFn` cast keeps the wiring compiling; the field names (`session_id`, `assistant`/`result` message types) are verified against the SDK in Task 18.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (all module tests green).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire entrypoint"
```

---

## Task 18: README + manual smoke test

**Files:**
- Create: `README.md` (replaces the stub)

- [ ] **Step 1: Write `README.md`** with setup + run instructions

```markdown
# yeshivish — Claude Code over SMS

Drive a Claude Code agent on this PC by texting a GroupMe group. See the design
and plan in `docs/superpowers/`.

## Prerequisites
- Node 20+ (developed on 24)
- A Claude Code login or `ANTHROPIC_API_KEY` in your environment
- `cloudflared` installed: `brew install cloudflared`
- A GroupMe account + API token from https://dev.groupme.com

## One-time setup
1. `npm install`
2. `cp config.example.yaml config.yaml`
3. Create a named cloudflared tunnel and a public hostname:
   - `cloudflared tunnel login`
   - `cloudflared tunnel create yeshivish`
   - Route a hostname to it (e.g. `cloudflared tunnel route dns yeshivish sms.example.com`)
   - Map the hostname to `http://localhost:8787` in your tunnel config.
4. Create a GroupMe group, then register a bot pointed at the tunnel:
   `POST https://api.groupme.com/v3/bots?token=YOUR_TOKEN` with
   `bot[name]`, `bot[group_id]`, and `bot[callback_url]=https://sms.example.com/groupme/callback`.
   Save the returned `bot_id`.
5. Find your own GroupMe `sender_id` (post a message; it appears in the callback log).
6. Run `npm start`, open http://localhost:8787/, and fill in the config form.

## Running
- `npm start` — starts the server and (if configured) the cloudflared tunnel.
- Text the group: a plain message runs the agent; `/help` lists commands.
- Risky actions (writes, Bash) text you a YES/NO prompt — reply `YES` to allow.

## Commands
`/new`, `/resume [id]`, `/sessions`, `/stop`, `/help`
```

- [ ] **Step 2: Manual smoke test — server + GUI**

Run: `npm start`
Then in a browser open `http://localhost:8787/`.
Expected: the config form renders with current values. Editing and saving
updates `config.yaml`. Stop with Ctrl-C.

- [ ] **Step 3: Manual smoke test — end to end over SMS**

With `config.yaml` filled and the tunnel running, text the group "what is 2+2?".
Expected: a concise plain-text reply arrives as SMS within a few seconds. Then
text "create a file test.txt with hi in it"; expected: a YES/NO confirmation
text arrives; replying `YES` lets the Write proceed and the file appears in the
workspace dir. Verify field names against the SDK if the agent never replies
(check that `session_id` and assistant text are being captured in `agent.ts`).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup and usage README"
```

---

## Self-Review Notes

- **Spec coverage:** tunnel (Task 16/18), callback server (15), gateway/filter +
  dedupe (9), session manager + `/new`/`/resume`/`/sessions` (5, 8), agent runner
  with resume/cwd/permissionMode/allowedTools (12), permission broker SMS-confirm
  + timeout (10), outbound chunked sender (3, 6), `config.yaml` + committed
  `config.example.yaml` template (1, 7) [covers the inline spec note], localhost
  GUI (14, 15), built-in CLAUDE.md + systemPrompt append (11, 12), command
  vocabulary incl. `/stop` abort (8, 13, 17), error handling/retry/dedupe/ignore
  (6, 9, 17), security localhost guard + single-sender allowlist (9, 15), testing
  unit + integration + manual (per-task + 18).
- **Risk note:** the exact Agent SDK message field names (`session_id`,
  `assistant`/`result` message shapes) and the `query` option names are confirmed
  against current docs but should be re-verified during Task 18's live run; the
  injected `QueryFn` keeps everything else testable regardless.
```
