#!/usr/bin/env bash
# install.sh — get yeshivish running in one shot.
#
#   curl -fsSL https://raw.githubusercontent.com/lubabs770/Yeshivish/main/install.sh | bash
#
# Clones (if needed), installs deps, seeds config.yaml, starts the server, and
# pops open the config GUI at http://localhost:8787/ . Bam.
set -euo pipefail

REPO_URL="https://github.com/lubabs770/Yeshivish.git"
TARGET_DIR="${YESHIVISH_DIR:-$HOME/yeshivish}"
PORT="${PORT:-8787}"
URL="http://localhost:${PORT}/"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 1. Prerequisites ----------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js 20+ is required — https://nodejs.org/"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))."
command -v npm >/dev/null 2>&1 || die "npm is required."
command -v git >/dev/null 2>&1 || die "git is required."

# 2. Get the code -----------------------------------------------------------
# Run-in-place if we're already inside the repo; otherwise clone or update.
if [ -f "config.example.yaml" ] && [ -d "src" ]; then
  TARGET_DIR="$(pwd)"
  say "Using current checkout: ${TARGET_DIR}"
elif [ -d "${TARGET_DIR}/.git" ]; then
  say "Updating existing checkout: ${TARGET_DIR}"
  git -C "${TARGET_DIR}" pull --ff-only
else
  say "Cloning into ${TARGET_DIR}"
  git clone "${REPO_URL}" "${TARGET_DIR}"
fi
cd "${TARGET_DIR}"

# 3. Install dependencies ---------------------------------------------------
say "Installing dependencies"
if [ -f package-lock.json ]; then npm ci || npm install; else npm install; fi

# 4. Seed config (npm start does this too, but be explicit) ------------------
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  say "Created config.yaml from the template"
fi

# 5. Launch and open the GUI ------------------------------------------------
open_url() {
  if   command -v open      >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open  >/dev/null 2>&1; then xdg-open "$1"
  elif command -v wslview   >/dev/null 2>&1; then wslview "$1"
  else say "Open this in your browser: $1"; fi
}

port_ready() {
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null "${URL}"
  else
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null && { exec 3>&- 3<&-; return 0; } || return 1
  fi
}

say "Starting yeshivish…"
npm start &
SERVER_PID=$!
trap 'kill "${SERVER_PID}" 2>/dev/null || true' INT TERM EXIT

say "Waiting for the server on ${URL}"
for _ in $(seq 1 60); do
  if port_ready; then break; fi
  kill -0 "${SERVER_PID}" 2>/dev/null || die "Server exited before it came up — check the log above."
  sleep 0.5
done
port_ready || die "Timed out waiting for ${URL}."

say "bam → opening ${URL}"
open_url "${URL}"

# Hand the terminal to the server so Ctrl-C stops everything.
wait "${SERVER_PID}"
