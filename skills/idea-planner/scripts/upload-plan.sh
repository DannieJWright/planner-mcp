#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <plan-markdown-file>\n' "$0" >&2
  exit 2
fi

plan_file=$1
api_url=${PLANNER_API_URL:-http://127.0.0.1:3000}

if [[ ! -f "$plan_file" ]]; then
  printf 'Plan file not found: %s\n' "$plan_file" >&2
  exit 2
fi

response=$(curl --fail-with-body --silent --show-error \
  --request PUT \
  --header 'Content-Type: text/markdown' \
  --data-binary "@$plan_file" \
  "${api_url%/}/plans")

node -e 'const data=JSON.parse(process.argv[1]); if(typeof data.reference!=="string") throw new Error("API response has no reference"); process.stdout.write(data.reference+"\n")' "$response"
