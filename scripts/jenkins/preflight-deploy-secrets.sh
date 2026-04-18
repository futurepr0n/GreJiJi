#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-.env}"

source "${SCRIPT_DIR}/deploy-required-secrets.sh"

log() {
  printf '[deploy-preflight] %s\n' "$*"
}

fail() {
  printf '[deploy-preflight] ERROR: %s\n' "$*" >&2
  exit 1
}

env_file_value() {
  local key="$1"

  [[ -f "$ENV_FILE" ]] || return 0

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

main() {
  local required_keys_csv="${REQUIRED_CREDENTIAL_KEYS:-$(deploy_required_secret_keys_csv)}"
  local credential_keys=()
  local missing_keys=()
  local placeholder_keys=()

  IFS=', ' read -r -a credential_keys <<< "$required_keys_csv"

  for key in "${credential_keys[@]}"; do
    [[ -z "$key" ]] && continue
    local value=""
    value="$(read_config_value "$key")"
    if [[ -z "$value" ]]; then
      missing_keys+=("$key")
      continue
    fi
    if is_placeholder_deploy_secret_value "$value"; then
      placeholder_keys+=("$key")
    fi
  done

  if [[ "${#missing_keys[@]}" -gt 0 || "${#placeholder_keys[@]}" -gt 0 ]]; then
    local diagnostics=()
    if [[ "${#missing_keys[@]}" -gt 0 ]]; then
      diagnostics+=("missing values: ${missing_keys[*]}")
    fi
    if [[ "${#placeholder_keys[@]}" -gt 0 ]]; then
      diagnostics+=("placeholder values: ${placeholder_keys[*]}")
    fi
    fail "Deploy secret preflight failed (${diagnostics[*]}). Remediation: set non-placeholder Jenkins password parameters or environment credentials for these exact keys (for example AUTH_TOKEN_SECRET) before Deploy Docker."
  fi

  log "Required deploy secrets present: ${credential_keys[*]}"
}

main "$@"
