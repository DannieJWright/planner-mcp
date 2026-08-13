#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  printf 'Usage: %s <reference-id> <destination-file>\n' "$0" >&2
  exit 2
fi

reference=$1
destination=$2
api_url=${PLANNER_API_URL:-http://127.0.0.1:3000}
destination_dir=$(dirname "$destination")
mkdir -p "$destination_dir"
temporary=$(mktemp "${destination}.tmp.XXXXXX")
trap 'rm -f "$temporary"' EXIT

curl --fail-with-body --silent --show-error \
  --output "$temporary" \
  "${api_url%/}/plans/${reference}"
mv "$temporary" "$destination"
trap - EXIT
