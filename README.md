# yeshivish — Claude Code over SMS

Drive a Claude Code agent on this PC by texting a GroupMe group. See the design
and plan in `docs/superpowers/`.

## Quick install
One command — clones, installs, starts the server, and opens the config GUI at
http://localhost:8787/ :
```sh
curl -fsSL https://raw.githubusercontent.com/lubabs770/Yeshivish/main/install.sh | bash
```
Or clone first and run it yourself:
```sh
git clone https://github.com/lubabs770/Yeshivish.git ~/yeshivish && cd ~/yeshivish && ./install.sh
```
The browser pops open on port 8787; fill in the form, then finish the tunnel +
GroupMe steps under [One-time setup](#one-time-setup). (Override the location or
port with `YESHIVISH_DIR=…` / `PORT=…`.)

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
