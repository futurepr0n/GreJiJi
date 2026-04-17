#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_PATH="$ROOT_DIR/scripts/jenkins/deploy-docker.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || fail "expected output to contain '$needle'"
}

make_fake_bin() {
  local dir="$1"

  cat >"$dir/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail

if [[ "$1" == "compose" ]]; then
  shift
  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --env-file|-f)
        shift 2
        ;;
      config)
        exit 0
        ;;
      up)
        exit 0
        ;;
      ps)
        if [[ "${DOCKER_FAKE_PS_MODE:-previous}" == "previous" ]]; then
          printf 'prev-container\n'
          export DOCKER_FAKE_PS_MODE="new"
        else
          printf 'new-container\n'
        fi
        exit 0
        ;;
      logs)
        printf 'mock logs\n'
        exit 0
        ;;
      *)
        shift
        ;;
    esac
  done
  exit 0
fi

case "$1" in
  port)
    printf '0.0.0.0:%s\n' "${APP_HOST_PORT:-3333}"
    ;;
  inspect)
    printf '%s\n' "${DOCKER_FAKE_INSPECT_REF:-grejiji-api:previous}"
    ;;
  tag)
    exit 0
    ;;
  ps)
    # Force is_port_in_use() fallback path to report no binding conflicts.
    exit 0
    ;;
  *)
    echo "unsupported fake docker command: $*" >&2
    exit 1
    ;;
esac
DOCKER
  chmod +x "$dir/docker"

  cat >"$dir/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail

output_file=""
format=""
url=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    -o)
      output_file="$2"
      shift 2
      ;;
    -w)
      format="$2"
      shift 2
      ;;
    -s|-S|-sS)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

mode="${CURL_FAKE_MODE:-rollback_success}"
status="200"
body='{"status":"ok"}'

if [[ "$mode" == "rollback_success" ]]; then
  if [[ "$url" == *"/__force_fail__"* ]]; then
    status="404"
    body='{"error":"route not found"}'
  fi
elif [[ "$mode" == "rollback_failure" ]]; then
  status="404"
  body='{"error":"route not found"}'
fi

if [[ -n "$output_file" ]]; then
  printf '%s\n' "$body" >"$output_file"
fi

if [[ "$format" == "%{http_code}" ]]; then
  printf '%s' "$status"
fi
CURL
  chmod +x "$dir/curl"
}

run_script_case() {
  local mode="$1"
  local health_path="$2"
  local rollback_path="$3"

  local sandbox
  sandbox="$(mktemp -d)"
  trap 'rm -rf "$sandbox"' RETURN

  mkdir -p "$sandbox/fake-bin"
  make_fake_bin "$sandbox/fake-bin"

  cat >"$sandbox/.env" <<'ENV'
AUTH_TOKEN_SECRET=test-secret
PAYMENT_PROVIDER=none
ENV
  cat >"$sandbox/docker-compose.yml" <<'COMPOSE'
services:
  api:
    image: grejiji-api:local
COMPOSE

  local output rc
  set +e
  output="$({
    PATH="$sandbox/fake-bin:$PATH" \
    APP_HOST_PORT=3333 \
    APP_CONTAINER_PORT=3000 \
    APP_SERVICE_NAME=api \
    APP_IMAGE_REF=grejiji-api:local \
    HEALTHCHECK_TIMEOUT_SECONDS=1 \
    HEALTHCHECK_INTERVAL_SECONDS=0 \
    HEALTHCHECK_PATH="$health_path" \
    ROLLBACK_HEALTHCHECK_PATH="$rollback_path" \
    HEALTHCHECK_SCHEME=http \
    HEALTHCHECK_HOST=127.0.0.1 \
    REQUIRE_JENKINS_CONTEXT=0 \
    REQUIRED_CREDENTIAL_KEYS=AUTH_TOKEN_SECRET \
    ENV_FILE="$sandbox/.env" \
    COMPOSE_FILE="$sandbox/docker-compose.yml" \
    CURL_FAKE_MODE="$mode" \
    bash "$SCRIPT_PATH"
  } 2>&1)"
  rc=$?
  set -e

  printf '%s\n' "$output"
  return "$rc"
}

test_rollback_success() {
  local output rc=0
  set +e
  output="$(run_script_case rollback_success /__force_fail__ /health)"
  rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || fail "rollback success path should still fail deploy command after rollback"
  assert_contains "$output" "Rollback succeeded and service is healthy."
  assert_contains "$output" "Healthcheck failure summary:"
}

test_rollback_failure_summary() {
  local output rc=0
  set +e
  output="$(run_script_case rollback_failure /__force_fail__ /health)"
  rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || fail "rollback failure case should fail"
  assert_contains "$output" "Healthcheck failure summary:"
  assert_contains "$output" "last_status='404'"
  assert_contains "$output" "path='/health'"
}

test_preflight_rejects_empty_rollback_path() {
  local output rc=0
  set +e
  output="$(run_script_case rollback_success /health '')"
  rc=$?
  set -e
  [[ "$rc" -ne 0 ]] || fail "empty rollback path should fail preflight"
  assert_contains "$output" "ROLLBACK_HEALTHCHECK_PATH path must start with '/'"
}

test_preflight_rejects_unresolved_host_vars() {
  local sandbox
  sandbox="$(mktemp -d)"
  trap 'rm -rf "$sandbox"' RETURN
  mkdir -p "$sandbox/fake-bin"
  make_fake_bin "$sandbox/fake-bin"

  cat >"$sandbox/.env" <<'ENV'
AUTH_TOKEN_SECRET=test-secret
PAYMENT_PROVIDER=none
ENV
  cat >"$sandbox/docker-compose.yml" <<'COMPOSE'
services:
  api:
    image: grejiji-api:local
COMPOSE

  local output rc=0
  set +e
  output="$({
    PATH="$sandbox/fake-bin:$PATH" \
    APP_HOST_PORT=3333 \
    APP_CONTAINER_PORT=3000 \
    APP_SERVICE_NAME=api \
    APP_IMAGE_REF=grejiji-api:local \
    HEALTHCHECK_TIMEOUT_SECONDS=1 \
    HEALTHCHECK_INTERVAL_SECONDS=0 \
    HEALTHCHECK_PATH=/health \
    ROLLBACK_HEALTHCHECK_PATH=/health \
    HEALTHCHECK_SCHEME=http \
    HEALTHCHECK_HOST='${HEALTH_HOST}' \
    REQUIRE_JENKINS_CONTEXT=0 \
    REQUIRED_CREDENTIAL_KEYS=AUTH_TOKEN_SECRET \
    ENV_FILE="$sandbox/.env" \
    COMPOSE_FILE="$sandbox/docker-compose.yml" \
    CURL_FAKE_MODE=rollback_success \
    bash "$SCRIPT_PATH"
  } 2>&1)"
  rc=$?
  set -e

  [[ "$rc" -ne 0 ]] || fail "unresolved host vars should fail preflight"
  assert_contains "$output" "HEALTHCHECK_PATH contains unresolved shell variable tokens."
}

test_rollback_success
test_rollback_failure_summary
test_preflight_rejects_empty_rollback_path
test_preflight_rejects_unresolved_host_vars

echo "PASS: jenkins deploy rollback-health diagnostics + guardrail tests"
