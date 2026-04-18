#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
ENV_FILE="${ENV_FILE:-.env}"
HOST_PORT="${APP_HOST_PORT:-}"
CONTAINER_PORT="${APP_CONTAINER_PORT:-3000}"
ALLOW_PORT_FALLBACK="${ALLOW_PORT_FALLBACK:-0}"
APP_SERVICE_NAME="${APP_SERVICE_NAME:-api}"
APP_IMAGE_REF="${APP_IMAGE_REF:-grejiji-api:local}"
HEALTHCHECK_PATH="${HEALTHCHECK_PATH:-/health}"
HEALTHCHECK_SCHEME="${HEALTHCHECK_SCHEME:-http}"
HEALTHCHECK_HOST="${HEALTHCHECK_HOST:-127.0.0.1}"
HEALTHCHECK_TIMEOUT_SECONDS="${HEALTHCHECK_TIMEOUT_SECONDS:-90}"
HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-3}"
REQUIRE_JENKINS_CONTEXT="${REQUIRE_JENKINS_CONTEXT:-1}"
REQUIRED_CREDENTIAL_KEYS="${REQUIRED_CREDENTIAL_KEYS:-}"
DOCKER_BIN="${DOCKER_BIN:-docker}"
CURL_BIN="${CURL_BIN:-curl}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "${SCRIPT_DIR}/deploy-required-secrets.sh"

if [[ -z "$REQUIRED_CREDENTIAL_KEYS" ]]; then
  REQUIRED_CREDENTIAL_KEYS="$(deploy_required_secret_keys_csv)"
fi

log() {
  printf '[deploy-docker] %s\n' "$*"
}

fail() {
  printf '[deploy-docker] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "$command_name" >/dev/null 2>&1 || fail "Missing required command: $command_name"
}

contains_unresolved_var() {
  [[ "$1" == *'$'* ]]
}

is_positive_port() {
  local value="$1"
  [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= 65535))
}

env_file_value() {
  local key="$1"
  awk -F'=' -v key="$key" '
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1)
      if ($1 == key) {
        value = substr($0, index($0, "=") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value
        exit
      }
    }
  ' "$ENV_FILE"
}

read_config_value() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s\n' "${!key}"
    return
  fi

  env_file_value "$key"
}

is_placeholder_secret() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$value" || "$value" == "change-me" || "$value" == "your-secret" ]]
}

is_valid_health_scheme() {
  [[ "$1" =~ ^https?$ ]]
}

is_valid_health_path() {
  local value="$1"
  [[ -n "$value" && "$value" =~ ^/[^[:space:]]*$ ]]
}

is_valid_health_host() {
  local value="$1"
  [[ "$value" =~ ^[a-zA-Z0-9.-]+$ || "$value" =~ ^\[[0-9a-fA-F:]+\]$ ]]
}

validate_health_target() {
  local label="$1"
  local path="$2"
  local scheme="$3"
  local host="$4"

  contains_unresolved_var "$path" && fail "${label} contains unresolved shell variable tokens."
  contains_unresolved_var "$scheme" && fail "${label} contains unresolved shell variable tokens."
  contains_unresolved_var "$host" && fail "${label} contains unresolved shell variable tokens."

  is_valid_health_path "$path" || fail "${label} path must start with '/' and contain no spaces."
  is_valid_health_scheme "$scheme" || fail "${label} scheme must be http or https."
  is_valid_health_host "$host" || fail "${label} host is malformed."

  local target_url="${scheme}://${host}:${HOST_PORT}${path}"
  [[ "$target_url" =~ ^https?://[^/]+/.+$ ]] || fail "${label} produced an invalid target URL."
}

run_compose() {
  APP_HOST_PORT="$HOST_PORT" APP_CONTAINER_PORT="$CONTAINER_PORT" \
    "$DOCKER_BIN" compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

image_repo_without_tag() {
  local image_ref="$1"
  local without_digest="${image_ref%@*}"
  local last_segment="${without_digest##*/}"

  # Strip only the final tag separator from the image name segment.
  # This preserves registry host:port prefixes such as registry:5000/repo.
  if [[ "$last_segment" == *:* ]]; then
    printf '%s\n' "${without_digest%:*}"
    return
  fi

  printf '%s\n' "$without_digest"
}

if [[ ! -f "$ENV_FILE" && -f .env.example ]]; then
  cp .env.example "$ENV_FILE"
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "Compose file not found: $COMPOSE_FILE"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  fail "Environment file not found: $ENV_FILE"
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

  "$DOCKER_BIN" ps --format '{{.Ports}}' | grep -E -q "(^|, )0\\.0\\.0\\.0:${port}->|(^|, ):::${port}->"
}

validate_context() {
  require_command "$DOCKER_BIN"
  require_command "$CURL_BIN"

  if [[ -z "$HOST_PORT" ]]; then
    fail "APP_HOST_PORT must be explicitly set."
  fi
  is_positive_port "$HOST_PORT" || fail "APP_HOST_PORT must be a valid port (1-65535)."
  is_positive_port "$CONTAINER_PORT" || fail "APP_CONTAINER_PORT must be a valid port (1-65535)."

  if [[ "$REQUIRE_JENKINS_CONTEXT" == "1" ]]; then
    [[ -n "${JENKINS_URL:-}" ]] || fail "JENKINS_URL is required for Jenkins deploy jobs."
    [[ -n "${JOB_NAME:-}" ]] || fail "JOB_NAME is required for Jenkins deploy jobs."
    [[ -n "${BUILD_NUMBER:-}" ]] || fail "BUILD_NUMBER is required for Jenkins deploy jobs."
  fi

  IFS=', ' read -r -a credential_keys <<< "$REQUIRED_CREDENTIAL_KEYS"
  for key in "${credential_keys[@]}"; do
    [[ -z "$key" ]] && continue
    value="$(read_config_value "$key")"
    if is_placeholder_secret "$value"; then
      fail "Required credential '$key' is missing or uses a placeholder value."
    fi
  done

  payment_provider="$(read_config_value "PAYMENT_PROVIDER" | tr '[:upper:]' '[:lower:]')"
  if [[ "$payment_provider" == "stripe" ]]; then
    stripe_secret="$(read_config_value "STRIPE_SECRET_KEY")"
    stripe_webhook_secret="$(read_config_value "STRIPE_WEBHOOK_SECRET")"
    is_placeholder_secret "$stripe_secret" && fail "STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe."
    is_placeholder_secret "$stripe_webhook_secret" && fail "STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe."
  fi

  local rollback_healthcheck_path="/health"
  if [[ "${ROLLBACK_HEALTHCHECK_PATH+x}" == "x" ]]; then
    rollback_healthcheck_path="$ROLLBACK_HEALTHCHECK_PATH"
  fi
  validate_health_target "HEALTHCHECK_PATH" "$HEALTHCHECK_PATH" "$HEALTHCHECK_SCHEME" "$HEALTHCHECK_HOST"
  validate_health_target "ROLLBACK_HEALTHCHECK_PATH" "$rollback_healthcheck_path" "$HEALTHCHECK_SCHEME" "$HEALTHCHECK_HOST"

  run_compose config >/dev/null
}

verify_port_binding() {
  local container_id="$1"
  local published_port
  published_port="$("$DOCKER_BIN" port "$container_id" "${CONTAINER_PORT}/tcp" 2>/dev/null | head -n 1 || true)"
  [[ -n "$published_port" ]] || fail "Container ${container_id} does not publish ${CONTAINER_PORT}/tcp."
  [[ "$published_port" == *":${HOST_PORT}" ]] || fail "Expected host port ${HOST_PORT}, got '${published_port}'."
}

verify_health() {
  local healthcheck_path="${1:-$HEALTHCHECK_PATH}"
  local target_url="${HEALTHCHECK_SCHEME}://${HEALTHCHECK_HOST}:${HOST_PORT}${healthcheck_path}"
  local deadline=$((SECONDS + HEALTHCHECK_TIMEOUT_SECONDS))
  local attempt=0
  local last_status="curl-error"
  local last_body=""

  while ((SECONDS <= deadline)); do
    attempt=$((attempt + 1))
    status="$("$CURL_BIN" -sS -o /tmp/grejiji-healthcheck.out -w '%{http_code}' "$target_url" || true)"
    last_status="$status"
    if [[ -f /tmp/grejiji-healthcheck.out ]]; then
      last_body="$(tr '\n' ' ' </tmp/grejiji-healthcheck.out | tr -s ' ' | cut -c1-180)"
    fi
    if [[ "$status" == "200" ]]; then
      return 0
    fi
    sleep "$HEALTHCHECK_INTERVAL_SECONDS"
  done

  log "Healthcheck failure summary: url='${target_url}' path='${healthcheck_path}' attempts='${attempt}' last_status='${last_status}' body_excerpt='${last_body}'"
  return 1
}

rollback_to_previous() {
  local rollback_tag="$1"
  local rollback_ref="$2"
  local rollback_healthcheck_path="/health"
  if [[ "${ROLLBACK_HEALTHCHECK_PATH+x}" == "x" ]]; then
    rollback_healthcheck_path="$ROLLBACK_HEALTHCHECK_PATH"
  fi

  [[ -n "$rollback_tag" && -n "$rollback_ref" ]] || fail "Rollback requested but no previous image reference is available."

  log "Attempting rollback to previous image '${rollback_ref}' (tagged as '${rollback_tag}')."
  "$DOCKER_BIN" tag "$rollback_tag" "$rollback_ref"
  run_compose up -d --no-build "$APP_SERVICE_NAME"

  local rollback_container_id
  rollback_container_id="$(run_compose ps -q "$APP_SERVICE_NAME")"
  [[ -n "$rollback_container_id" ]] || fail "Rollback failed: service container is not running."
  verify_port_binding "$rollback_container_id"
  verify_health "$rollback_healthcheck_path" || fail "Rollback completed but service failed health checks."
  log "Rollback succeeded and service is healthy."
}

validate_context

if is_port_in_use "$HOST_PORT"; then
  if [[ "$ALLOW_PORT_FALLBACK" != "1" ]]; then
    fail "Host port ${HOST_PORT} is already in use. Set APP_HOST_PORT or enable ALLOW_PORT_FALLBACK=1."
  fi

  for candidate in $(seq $((HOST_PORT + 1)) $((HOST_PORT + 50))); do
    if ! is_port_in_use "$candidate"; then
      HOST_PORT="$candidate"
      break
    fi
  done
fi

rollback_tag=""
rollback_ref=""
previous_container_id="$(run_compose ps -q "$APP_SERVICE_NAME")"
if [[ -n "$previous_container_id" ]]; then
  rollback_ref="$("$DOCKER_BIN" inspect --format '{{.Config.Image}}' "$previous_container_id" 2>/dev/null || true)"
  if [[ -n "$rollback_ref" ]]; then
    rollback_tag="$(image_repo_without_tag "$APP_IMAGE_REF"):rollback-${BUILD_NUMBER:-$(date +%s)}"
    "$DOCKER_BIN" tag "$rollback_ref" "$rollback_tag"
    log "Captured rollback image ${rollback_ref} as ${rollback_tag}."
  fi
fi

if ! run_compose up -d --build "$APP_SERVICE_NAME"; then
  log "Deploy command failed before verification. Collecting logs."
  run_compose logs --tail=200 "$APP_SERVICE_NAME" || true
  rollback_to_previous "$rollback_tag" "$rollback_ref"
  fail "Deployment failed and rollback was applied."
fi

new_container_id="$(run_compose ps -q "$APP_SERVICE_NAME")"
[[ -n "$new_container_id" ]] || fail "Deploy failed: service '${APP_SERVICE_NAME}' container is not running after deploy."

if ! verify_port_binding "$new_container_id"; then
  run_compose logs --tail=200 "$APP_SERVICE_NAME" || true
  rollback_to_previous "$rollback_tag" "$rollback_ref"
  fail "Deployment failed: port verification failed; rollback was applied."
fi

if ! verify_health; then
  log "Health verification failed; collecting service logs."
  run_compose logs --tail=200 "$APP_SERVICE_NAME" || true
  rollback_to_previous "$rollback_tag" "$rollback_ref"
  fail "Deployment failed: health verification failed; rollback was applied."
fi

log "Docker deployment complete using ${COMPOSE_FILE} on host port ${HOST_PORT}."
