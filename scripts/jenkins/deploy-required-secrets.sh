#!/usr/bin/env bash

# Central source of truth for Jenkins deploy-time secrets.
readonly REQUIRED_DEPLOY_SECRET_KEYS=(
  AUTH_TOKEN_SECRET
)

deploy_required_secret_keys_csv() {
  local IFS=','
  printf '%s\n' "${REQUIRED_DEPLOY_SECRET_KEYS[*]}"
}

is_placeholder_deploy_secret_value() {
  local value
  value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  [[ -z "$value" || "$value" == "change-me" || "$value" == "your-secret" || "$value" == "local-dev-secret-change-me" ]]
}
