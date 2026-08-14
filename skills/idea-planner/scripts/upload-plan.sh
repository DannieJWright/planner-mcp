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

response_file=$(mktemp)
trap 'rm -f "$response_file"' EXIT
if ! status=$(curl --silent --show-error \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --request PUT \
  --header 'Content-Type: text/markdown' \
  --data-binary "@$plan_file" \
  "${api_url%/}/plans"); then
  printf 'Failed to contact Planner API.\n' >&2
  exit 1
fi
response=$(<"$response_file")

if [[ ! "$status" =~ ^2 ]]; then
  node -e 'let message; try { const data=JSON.parse(process.argv[1]); message=data.error; } catch {} process.stderr.write((typeof message==="string" ? message : process.argv[1] || "Planner API request failed")+"\n")' "$response"
  exit 1
fi

node -e 'const data=JSON.parse(process.argv[1]); if(typeof data.reference!=="string") throw new Error("API response has no reference"); process.stdout.write(data.reference+"\n")' "$response"
