#!/usr/bin/env bash
#
# guard.sh — viciously keep the yeshivish bot (and its cloudflared tunnel)
# alive, and keep the machine awake the whole time it runs.
#
#   ./guard.sh start      # launch in background; on macOS, caffeinated
#   ./guard.sh status     # up? show the current public tunnel URL
#   ./guard.sh logs       # follow the log (Ctrl+C to stop watching)
#   ./guard.sh stop       # stop it (and let the machine sleep again)
#   ./guard.sh restart
#
# Works from wherever the repo is cloned — it locates itself. Override the
# project dir or start command with env vars if you need to:
#   YESHIVISH_DIR=/path/to/repo   YESHIVISH_CMD="npm start"
#
set -euo pipefail

# Repo root = the directory this script lives in (resolves symlinks).
SOURCE="${BASH_SOURCE[0]}"
while [[ -h "$SOURCE" ]]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"

# ---- config (override with env vars) -----------------------------------
PROJECT_DIR="${YESHIVISH_DIR:-$SCRIPT_DIR}"       # repo root by default
START_CMD="${YESHIVISH_CMD:-npm start}"           # how to launch the bot
RESTART_DELAY="${YESHIVISH_RESTART_DELAY:-3}"     # seconds between restarts
# ------------------------------------------------------------------------

NAME="yeshivish-guard"
STATE_DIR="${YESHIVISH_STATE_DIR:-$HOME/.yeshivish}"
PID_FILE="$STATE_DIR/$NAME.pid"
LOG_FILE="$STATE_DIR/$NAME.log"
mkdir -p "$STATE_DIR"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*" >>"$LOG_FILE"; }

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid; pid=$(cat "$PID_FILE" 2>/dev/null) || return 1
  [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null
}

cmd_start() {
  if is_running; then
    echo "$NAME already running (pid $(cat "$PID_FILE"))."; return 0
  fi
  : >"$LOG_FILE"
  # set -m → the background job gets its OWN process group, so 'stop' can take
  # out the whole tree (guard + bot + cloudflared + caffeinate) in one shot.
  # nohup → it survives the terminal closing.
  set -m
  nohup bash "$0" __supervise >>"$LOG_FILE" 2>&1 &
  local pid=$!
  set +m
  echo "$pid" >"$PID_FILE"
  sleep 1
  if is_running; then
    echo "started $NAME (pid $pid)."
    command -v caffeinate >/dev/null 2>&1 \
      && echo "  this machine will not idle-sleep while it runs." \
      || echo "  note: no 'caffeinate' here (non-macOS) — sleep prevention skipped."
    echo "  project : $PROJECT_DIR"
    echo "  command : $START_CMD"
    echo "  status  : $0 status        logs: $0 logs"
  else
    echo "failed to start — see $LOG_FILE"; return 1
  fi
}

cmd_stop() {
  if ! is_running; then echo "$NAME not running."; rm -f "$PID_FILE"; return 0; fi
  local pid; pid=$(cat "$PID_FILE")
  # Negative pid kills the entire process group (everything it spawned).
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in $(seq 1 20); do is_running || break; sleep 0.5; done
  is_running && { kill -KILL "-$pid" 2>/dev/null || true; }
  rm -f "$PID_FILE"
  echo "stopped $NAME."
}

cmd_status() {
  if is_running; then
    echo "RUNNING — $NAME (pid $(cat "$PID_FILE"))"
    local url
    url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -1 || true)
    if [[ -n "${url:-}" ]]; then
      echo "  public URL : $url"
      echo "               -> set this as your bot's callback at dev.groupme.com"
    else
      echo "  public URL : (not printed yet — try '$0 logs')"
    fi
  else
    echo "stopped — $NAME"
  fi
}

cmd_logs() { touch "$LOG_FILE"; tail -n 50 -f "$LOG_FILE"; }

# --- the supervisor loop (runs detached; not called directly) -----------
supervise() {
  CAF=""
  if command -v caffeinate >/dev/null 2>&1; then
    caffeinate -dimsu -w $$ & CAF=$!     # keep this machine awake while we live
  else
    log "note: 'caffeinate' not found — sleep prevention skipped"
  fi
  BOT=""
  cleanup() {
    [[ -n "$BOT" ]] && kill -TERM "$BOT" 2>/dev/null || true
    [[ -n "$CAF" ]] && kill "$CAF" 2>/dev/null || true
    exit 0
  }
  trap cleanup TERM INT
  log "guard up (pid $$)  project=$PROJECT_DIR  cmd=$START_CMD"
  while :; do
    if [[ ! -d "$PROJECT_DIR" ]]; then
      log "WAITING: project dir not found: $PROJECT_DIR — retry in 30s"
      sleep 30; continue
    fi
    log "starting bot: $START_CMD"
    ( cd "$PROJECT_DIR" && exec $START_CMD ) & BOT=$!
    local code=0
    wait "$BOT" || code=$?
    BOT=""
    log "bot exited (code $code) — restarting in ${RESTART_DELAY}s"
    sleep "$RESTART_DELAY"
  done
}

case "${1:-}" in
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_stop; sleep 1; cmd_start ;;
  status)       cmd_status ;;
  logs)         cmd_logs ;;
  __supervise)  supervise ;;   # internal use only
  *) echo "usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
esac
