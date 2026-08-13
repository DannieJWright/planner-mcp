#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <plan-markdown-file>\n' "$0" >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
reference=$("$script_dir/upload-plan.sh" "$1")
"$script_dir/download-plan.sh" "$reference" "$1"
printf '%s\n' "$reference"
