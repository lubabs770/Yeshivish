# yeshivish — Claude Code over SMS

Drive a Claude Code agent on this PC by texting a GroupMe group.

See the design and plan in `docs/superpowers/`.

&nbsp;

## Quick install

One command — clones, installs, starts the server, and opens the config GUI at <http://localhost:8787/>:

```sh
curl -fsSL https://raw.githubusercontent.com/lubabs770/Yeshivish/main/install.sh | bash
```

The browser pops open on port 8787; fill in the form, then finish the tunnel and GroupMe steps under [One-time setup](#one-time-setup).

&nbsp;

## Prerequisites

- **Node 20+** (developed on 24)
- A **Claude Code login** or `ANTHROPIC_API_KEY` in your environment
- **`cloudflared`** — `brew install cloudflared` *(only needed for webhook mode; see [Ingest modes](#ingest-modes))*
- A **GroupMe account** + API token from <https://dev.groupme.com>

&nbsp;

## Ingest modes

Yeshivish can receive messages two ways, set by `ingest.mode` in `config.yaml`:

| Mode | How it works | Setup |
|------|--------------|-------|
| **`webhook`** *(default)* | GroupMe POSTs each message to a public callback URL, exposed via a `cloudflared` tunnel. Lowest latency. | Requires the tunnel setup below. |
| **`poll`** | Yeshivish reads the GroupMe API on an adaptive timer — fast right after activity or while a YES/NO is pending, slow when quiet (tune with `poll.idle_ms` / `active_ms` / `decay_ms`). | No public endpoint, tunnel, or cloudflared. Skip steps 3–4 below. |

> [!NOTE]
> In **poll** mode you don't need a bot `callback_url`. Latency is `active_ms` (default 1s) while you're chatting.

&nbsp;

## One-time setup

1. `npm install`
2. `cp config.example.yaml config.yaml`
3. **Create a named cloudflared tunnel and a public hostname:**
   - `cloudflared tunnel login`
   - `cloudflared tunnel create yeshivish`
   - Route a hostname to it — e.g. `cloudflared tunnel route dns yeshivish sms.example.com`
   - Map the hostname to `http://localhost:8787` in your tunnel config.
4. **Create a GroupMe group, then register a bot pointed at the tunnel:**

   ```http
   POST https://api.groupme.com/v3/bots?token=YOUR_TOKEN
   ```

   with `bot[name]`, `bot[group_id]`, and `bot[callback_url]=https://sms.example.com/groupme/callback`. Save the returned `bot_id`.
5. **Find your own GroupMe `sender_id`** — post a message; it appears in the callback log.
6. **Run** `npm start`, open <http://localhost:8787/>, and fill in the config form.

&nbsp;

## Running

- `npm start` — starts the server, plus the cloudflared tunnel (webhook mode) or the API poller (poll mode).
- **Text the group:** a plain message runs the agent; `/help` lists commands.
- **Risky actions** (writes, Bash) text you a YES/NO prompt — reply `YES` to allow.

&nbsp;

## Keeping it alive (`guard.sh`)

`npm start` dies if it crashes, the terminal closes, or (in quick-tunnel mode) the machine sleeps — and each restart hands out a new tunnel URL.

`guard.sh` wraps it: it runs the bot detached in the background, **auto-restarts it forever** if it ever exits, and on macOS **`caffeinate`s the machine** so it won't idle-sleep while up.

```sh
./guard.sh start      # launch in background; caffeinated (macOS)
./guard.sh status     # is it up? prints the current public tunnel URL
./guard.sh logs       # follow the live log
./guard.sh stop       # stop it (and let the machine sleep again)
./guard.sh restart
```

It locates itself, so it works from wherever you cloned the repo. State (pid + log) lives in `~/.yeshivish/`.

**Overrides:** `YESHIVISH_DIR`, `YESHIVISH_CMD`, `YESHIVISH_RESTART_DELAY`

> [!NOTE]
> `caffeinate` cannot defeat lid-close (clamshell) sleep on battery — that's enforced by hardware.

&nbsp;

## Commands

| Command | Action |
|---------|--------|
| `/new` | Start a new session |
| `/resume [id]` | Resume a session |
| `/sessions` | List sessions |
| `/stop` | Stop the running agent |
| `/help` | List commands |
