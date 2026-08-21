#!/usr/bin/env bash
# Starts the full Kanso Chess app locally, end to end:
#   Docker runtime -> Postgres + LocalStack -> migrations -> SQS queue
#   -> API + Vite web + analysis worker
#
# Idempotent: safe to re-run; anything already running is left alone. All three
# processes log to .dev-logs/ and write a .pid file there. Stop them with
# scripts/dev-down.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUEUE_NAME="kanso-analysis-local"
QUEUE_URL="http://localhost:4566/000000000000/${QUEUE_NAME}"
LOG_DIR="$ROOT/.dev-logs"

log() { printf '\033[1;32m[dev-up]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[dev-up]\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found; install Docker Desktop or Colima"

# 1. Docker runtime (Colima on macOS).
if ! docker info >/dev/null 2>&1; then
  log "starting colima"
  colima start
fi

# 2. Postgres + LocalStack containers.
ensure_container() {
  local name="$1"
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    return 0
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    case "$name" in
      kanso-db-5433)
        log "creating Postgres container"
        docker run --name kanso-db-5433 -e POSTGRES_PASSWORD=postgres -p 5433:5432 -d postgres:18 >/dev/null
        ;;
      kanso-localstack)
        log "creating LocalStack container"
        docker run --name kanso-localstack -p 4566:4566 -e SERVICES=ses,sqs -d localstack/localstack:4 >/dev/null
        ;;
    esac
  fi
}
ensure_container kanso-db-5433
ensure_container kanso-localstack

# 3. Postgres ready -> dev database -> migrations.
log "waiting for Postgres"
until docker exec kanso-db-5433 pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
if ! docker exec kanso-db-5433 psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='kanso_dev'" | grep -q 1; then
  docker exec kanso-db-5433 createdb -U postgres kanso_dev
fi
log "applying migrations"
npm run db:migrate --workspace apps/api

# 4. The analysis queue (idempotent). Static credentials pin the client to
#    LocalStack so an expired AWS_PROFILE cannot hijack the endpoint.
if command -v aws >/dev/null 2>&1; then
  unset AWS_PROFILE
  AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
    aws --endpoint-url http://localhost:4566 sqs create-queue \
      --queue-name "$QUEUE_NAME" --region ap-south-2 >/dev/null 2>&1 || true
else
  log "aws cli not found; skipping queue creation (analysis worker will idle)"
fi

# 5. Dependencies.
if [ ! -d node_modules ]; then
  log "installing dependencies"
  npm install
fi

# 6. Local-only stubs that make the product runnable without AWS, Razorpay or
#    chess.com. .env.local already carries DATABASE_URL, AWS_ENDPOINT_URL and
#    CORS_ORIGINS, which server.ts loads itself.
export APP_ORIGIN="http://127.0.0.1:5173"
export BETTER_AUTH_URL="http://127.0.0.1:5173"
export SES_FROM_ADDRESS="sender@example.com"
export IMPORT_PROVIDER_STUB=1
export MAILER_STUB=1
export RAZORPAY_STUB=1
export ANALYSIS_QUEUE_URL="$QUEUE_URL"

mkdir -p "$LOG_DIR"

# The worker is plain node, so it does not auto-load .env.local the way
# server.ts does; expose DATABASE_URL and AWS_ENDPOINT_URL to it explicitly.
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env.local
  set +a
fi

start_api() {
  if curl -sf http://127.0.0.1:3000/health >/dev/null 2>&1; then
    log "api already running"
  else
    log "starting api"
    nohup npm start --workspace apps/api >"$LOG_DIR/api.log" 2>&1 &
    echo $! >"$LOG_DIR/api.pid"
  fi
}
start_web() {
  if curl -sf http://127.0.0.1:5173/ >/dev/null 2>&1; then
    log "web already running"
  else
    log "starting web"
    nohup npm run dev --workspace apps/web >"$LOG_DIR/web.log" 2>&1 &
    echo $! >"$LOG_DIR/web.pid"
  fi
}
start_worker() {
  if [ -f "$LOG_DIR/worker.pid" ] && kill -0 "$(cat "$LOG_DIR/worker.pid")" 2>/dev/null; then
    log "worker already running"
  else
    log "starting worker"
    nohup node scripts/dev-worker.mjs >"$LOG_DIR/worker.log" 2>&1 &
    echo $! >"$LOG_DIR/worker.pid"
  fi
}

start_api
start_web
start_worker

log "web:    http://127.0.0.1:5173"
log "api:    http://127.0.0.1:3000"
log "logs:   $LOG_DIR/{api,web,worker}.log"
log "stop:   scripts/dev-down.sh"
