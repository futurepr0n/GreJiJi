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

is_placeholder_secret() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$value" || "$value" == "change-me" || "$value" == "your-secret" ]]
}

main() {
  local required_keys_csv="${REQUIRED_CREDENTIAL_KEYS:-$(deploy_required_secret_keys_csv)}"
  local credential_keys=()
  local missing_keys=()

  IFS=', ' read -r -a credential_keys <<< "$required_keys_csv"

  for key in "${credential_keys[@]}"; do
    [[ -z "$key" ]] && continue
    local value=""
    value="$(read_config_value "$key")"
    if is_placeholder_secret "$value"; then
      missing_keys+=("$key")
    fi
  done

  if [[ "${#missing_keys[@]}" -gt 0 ]]; then
    fail "Missing required deploy secrets: ${missing_keys[*]}. Remediation: set Jenkins credentials or build parameters for these keys before Deploy Docker."
  fi

  log "Required deploy secrets present: ${credential_keys[*]}"
}

main "$@"
