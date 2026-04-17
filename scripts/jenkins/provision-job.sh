#!/usr/bin/env bash
set -euo pipefail

: "${JENKINS_BASE_URL:?Set JENKINS_BASE_URL}"
: "${JENKINS_USER:?Set JENKINS_USER}"
: "${JENKINS_TOKEN:?Set JENKINS_TOKEN}"
: "${JENKINS_REPO_URL:?Set JENKINS_REPO_URL}"

JENKINS_FOLDER="${JENKINS_FOLDER:-}"
JENKINS_JOB="${JENKINS_JOB:-GreJiJi}"
JENKINS_BRANCH="${JENKINS_BRANCH:-*/main}"
JENKINS_SCRIPT_PATH="${JENKINS_SCRIPT_PATH:-Jenkinsfile}"
JENKINS_GIT_CREDENTIALS_ID="${JENKINS_GIT_CREDENTIALS_ID:-}"

cmd=(
  node ./scripts/jenkins/provision-job.js
  --base-url "$JENKINS_BASE_URL"
  --user "$JENKINS_USER"
  --token "$JENKINS_TOKEN"
  --repo-url "$JENKINS_REPO_URL"
  --job "$JENKINS_JOB"
  --branch "$JENKINS_BRANCH"
  --script-path "$JENKINS_SCRIPT_PATH"
)

if [[ -n "$JENKINS_FOLDER" ]]; then
  cmd+=(--folder "$JENKINS_FOLDER")
fi

if [[ -n "$JENKINS_GIT_CREDENTIALS_ID" ]]; then
  cmd+=(--credentials-id "$JENKINS_GIT_CREDENTIALS_ID")
fi

"${cmd[@]}"
