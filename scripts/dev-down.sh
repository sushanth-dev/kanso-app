#!/usr/bin/env bash
# Stops the local dev processes started by scripts/dev-up.sh. Leaves the
# Postgres and LocalStack containers running so a re-run is fast.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/.dev-logs"

for name in api web worker; do
  pid_file="$LOG_DIR/$name.pid"
  if [ -f "$pid_file" ]; then
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      printf '[dev-down] stopped %s (%s)\n' "$name" "$pid"
    fi
    rm -f "$pid_file"
  fi
done

# Vite's npm wrapper can leave a child behind; sweep the workspace scripts.
pkill -f 'vite' 2>/dev/null || true
pkill -f 'src/server.ts' 2>/dev/null || true
pkill -f 'scripts/dev-worker.mjs' 2>/dev/null || true

printf '[dev-down] done\n'
