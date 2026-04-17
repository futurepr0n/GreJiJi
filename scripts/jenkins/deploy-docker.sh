#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
HOST_PORT="${APP_HOST_PORT:-3333}"
CONTAINER_PORT="${APP_CONTAINER_PORT:-3000}"
ALLOW_PORT_FALLBACK="${ALLOW_PORT_FALLBACK:-0}"

if [[ ! -f "$ENV_FILE" && -f .env.example ]]; then
  cp .env.example "$ENV_FILE"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Compose file not found: $COMPOSE_FILE" >&2
  exit 1
fi

is_port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" | tail -n +2 | grep -q .
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  docker ps --format '{{.Ports}}' | grep -E -q "(^|, )0\\.0\\.0\\.0:${port}->|(^|, ):::${port}->"
}

if is_port_in_use "$HOST_PORT"; then
  if [[ "$ALLOW_PORT_FALLBACK" != "1" ]]; then
    echo "Host port ${HOST_PORT} is already in use. Set APP_HOST_PORT or enable ALLOW_PORT_FALLBACK=1." >&2
    exit 1
  fi

  for candidate in $(seq $((HOST_PORT + 1)) $((HOST_PORT + 50))); do
    if ! is_port_in_use "$candidate"; then
      HOST_PORT="$candidate"
      break
    fi
  done
fi

APP_HOST_PORT="$HOST_PORT" APP_CONTAINER_PORT="$CONTAINER_PORT" docker compose -f "$COMPOSE_FILE" up -d --build

echo "Docker deployment complete using $COMPOSE_FILE on host port ${HOST_PORT}"
